/**
 * The API.
 *
 * Shape: **collection-level GET and PUT**. `GET /api/seeds` returns the whole
 * array, `PUT /api/seeds` replaces it. That is not a shortcut — it is the same
 * contract the React views already have. Each view receives `(data, setData)`
 * and hands back a complete new array; mirroring that here means the client's
 * storage layer can be swapped from `localStorage` to `fetch` without touching a
 * single view component.
 *
 * A per-item CRUD surface would need ids threaded through every mutation, an
 * optimistic-update story and a merge strategy, for one user editing a few dozen
 * rows. Replace is cheaper to write, far cheaper to reason about, and trivially
 * atomic.
 *
 * `/settings` is the one endpoint that is not a collection. It is a singleton —
 * one object in, one object out — and it deliberately does not take `If-Match`.
 * The reasoning is written out at the handler.
 */
import express from 'express';
import type { Router } from 'express';
import type {
  BackupStatusBody,
  CollectionName,
  GardenBed,
  HarvestLog,
  HomeAssistantBody,
  ImportResultBody,
  IntegrationStatusBody,
  RestoreResultBody,
  SeedPacket,
  VersionToken,
} from '@hpt/shared';
import type { Database } from '../db/open.ts';
import { withTransaction } from '../db/open.ts';
import {
  listBeds,
  listHarvests,
  listSeeds,
  replaceBeds,
  replaceHarvests,
  replaceSeeds,
} from '../db/collections.ts';
import { readSettings, writeSettings } from '../db/settings.ts';
import { bumpVersion, readAllVersions, readVersion, replaceIfCurrent } from '../db/versions.ts';
import { appliedVersions } from '../db/migrate.ts';
import { readLastExportAt, writeLastExportAt } from '../db/appState.ts';
import { listSafetyCopies, readSafetyCopy } from '../db/snapshots.ts';
import {
  backupFilename,
  buildDocument,
  currentCounts,
  prettyJson,
} from '../backup/document.ts';
import { applyRestore } from '../backup/restore.ts';
import {
  parseIfMatch,
  requireJsonBody,
  sendError,
  sendImportConflict,
  sendValidationError,
  sendVersionConflict,
  versionToken,
} from '../http.ts';
import type { ValidationResult } from '../validation.ts';
import {
  validateBackupDocument,
  validateBeds,
  validateHarvests,
  validateSeeds,
  validateSettings,
  validateSnapshot,
} from '../validation.ts';

/** Bodies are three small arrays; 4 MB is roomy for a decade of harvests. */
const BODY_LIMIT = '4mb';

/** Counters -> entity tags, so every version leaves the server in the same form. */
function tokenise(
  versions: Record<CollectionName, number>,
): Record<CollectionName, VersionToken> {
  return {
    seeds: versionToken(versions.seeds),
    beds: versionToken(versions.beds),
    harvests: versionToken(versions.harvests),
  };
}

/**
 * `3 seeds, 1 bed and 14 harvests`.
 *
 * Singular where singular is correct, because the one place this appears is the
 * sentence confirming that her garden was just replaced, and "1 beds" in that
 * sentence is a small signal that nobody was paying attention to the big one.
 */
function describeCounts(counts: Record<CollectionName, number>): string {
  const parts = [
    `${counts.seeds} ${counts.seeds === 1 ? 'seed packet' : 'seed packets'}`,
    `${counts.beds} ${counts.beds === 1 ? 'bed' : 'beds'}`,
    `${counts.harvests} ${counts.harvests === 1 ? 'harvest' : 'harvests'}`,
  ];

  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

interface CollectionEndpoint<T> {
  name: CollectionName;
  path: string;
  read: (db: Database) => T[];
  replace: (db: Database, items: readonly T[]) => void;
  validate: (raw: unknown) => ValidationResult<T[]>;
}

const SEEDS: CollectionEndpoint<SeedPacket> = {
  name: 'seeds',
  path: '/seeds',
  read: listSeeds,
  replace: replaceSeeds,
  validate: validateSeeds,
};

const BEDS: CollectionEndpoint<GardenBed> = {
  name: 'beds',
  path: '/beds',
  read: listBeds,
  replace: replaceBeds,
  validate: validateBeds,
};

const HARVESTS: CollectionEndpoint<HarvestLog> = {
  name: 'harvests',
  path: '/harvests',
  read: listHarvests,
  replace: replaceHarvests,
  validate: validateHarvests,
};

/** Everything the API needs beyond the database. All of it optional. */
export interface ApiRouterOptions {
  /**
   * Told after any write that changes what Home Assistant publishes.
   *
   * Optional and fire-and-forget by design: on a laptop there is no Home
   * Assistant and this is simply absent, and even when present the request must
   * not wait on it. A harvest is saved at exactly the speed it was before this
   * feature existed.
   */
  onGardenChanged?: () => void;
  /** Answers `GET /api/home-assistant`. Absent means "there is no Home Assistant". */
  homeAssistant?: () => HomeAssistantBody;
  /** Answers `GET /api/home-assistant/status`. Absent for the same reason. */
  integrationStatus?: () => IntegrationStatusBody;
}

function mountCollection<T>(
  router: Router,
  db: Database,
  endpoint: CollectionEndpoint<T>,
  options: ApiRouterOptions,
): void {
  /** Version and contents read together, so the ETag always describes the body beside it. */
  const readCurrent = (): { version: number; items: T[] } =>
    withTransaction(db, () => ({
      version: readVersion(db, endpoint.name),
      items: endpoint.read(db),
    }));

  router.get(endpoint.path, (_req, res) => {
    const current = readCurrent();

    // Set before `json`, because Express only auto-generates an ETag when one is
    // absent — so ours wins. It also turns on conditional-GET handling: a phone
    // polling with `If-None-Match` gets a 304 and no body.
    res.set('ETag', versionToken(current.version));
    res.json(current.items);
  });

  router.put(endpoint.path, requireJsonBody, (req, res) => {
    // Validation before the precondition, per RFC 9110 §13.2.1: a request that
    // would fail anyway should say so, rather than sending the client off to
    // refetch and retry a payload that was never going to be accepted.
    const result = endpoint.validate(req.body);

    if (!result.ok) {
      sendValidationError(res, result.issues);
      return;
    }

    const ifMatch = parseIfMatch(req.get('if-match'));

    if (ifMatch.kind !== 'version') {
      // No usable precondition. Refused rather than applied — an unversioned
      // write is exactly the stale-tab overwrite this whole mechanism exists to
      // stop, and it is indistinguishable from one. The current state rides
      // along so an honest client recovers in a single round trip.
      const current = readCurrent();

      sendVersionConflict(res, 428, endpoint.name, versionToken(current.version), current.items, {
        message:
          ifMatch.kind === 'absent'
            ? `This write must declare the version it is editing from. Send If-Match with the ` +
              `ETag from your last GET of /api/${endpoint.name}. Nothing was saved.`
            : `If-Match was ${JSON.stringify(ifMatch.raw)}, which is not a version this server ` +
              `issued. Note that "*" is rejected too: a collection always exists, so it would ` +
              `match unconditionally and protect nothing. Nothing was saved.`,
      });
      return;
    }

    // Check and write in one transaction. Splitting them would leave a window in
    // which two requests both read version 3, both judge themselves current and
    // both write — the lost update, reintroduced with extra steps.
    const write = replaceIfCurrent(
      db,
      endpoint.name,
      ifMatch.version,
      result.value,
      endpoint.replace,
      endpoint.read,
    );

    if (!write.ok) {
      sendVersionConflict(
        res,
        409,
        endpoint.name,
        versionToken(write.currentVersion),
        write.current,
        {
          message:
            `The ${endpoint.name} collection changed since you loaded it, so saving would have ` +
            `discarded that change. Nothing was saved. Reconcile your edit against "current" ` +
            `and retry with the new version in If-Match.`,
          expectedVersion: versionToken(ifMatch.version),
        },
      );
      return;
    }

    // The new ETag, so a client can keep writing without a follow-up GET. The
    // body is read back from the database rather than echoed from the request,
    // so it is proof of what was actually stored.
    res.set('ETag', versionToken(write.version));
    res.json(write.items);

    // After the response, never before it. Home Assistant is downstream of her
    // garden, not in front of it.
    options.onGardenChanged?.();
  });
}

export function createApiRouter(db: Database, options: ApiRouterOptions = {}): Router {
  const router = express.Router();

  router.use(
    express.json({
      limit: BODY_LIMIT,
      type: 'application/json',
      // `strict: false` so a scalar body like `42` or `"nope"` is parsed and then
      // rejected by the validator with "expected an array, received number".
      // Leaving it strict would report it as a JSON parse failure, which is
      // simply untrue and sends whoever is debugging an import in the wrong
      // direction.
      strict: false,
    }),
  );

  router.get('/health', (_req, res) => {
    // Touch the database so the check fails if the file has gone away, which is
    // the failure systemd and uptime monitoring actually need to see.
    const versions = appliedVersions(db);

    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      schemaVersion: versions.at(-1) ?? 0,
      timestamp: new Date().toISOString(),
    });
  });

  mountCollection(router, db, SEEDS, options);
  mountCollection(router, db, BEDS, options);
  mountCollection(router, db, HARVESTS, options);

  /**
   * What Home Assistant has to say about her garden, for the frost banner.
   *
   * Deliberately **not** a proxy to Home Assistant. The browser gets a small,
   * purpose-built body containing only what the banner renders, because the
   * credential this server uses to reach Home Assistant — `SUPERVISOR_TOKEN` —
   * would be catastrophic to expose and is not needed to draw a warning.
   *
   * Always `200`, and always fast. "There is no Home Assistant here" is a
   * normal answer that arrives as data (`available: false`), not as a `404`, a
   * `503` or a timeout, because the app is developed and tested on a laptop
   * where that is the permanent state of affairs. The client renders nothing
   * and there is no error state to design.
   *
   * The response is built from a cached forecast plus a local database read.
   * Nothing in this handler can touch the network, so Home Assistant being
   * slow, restarting or absent cannot make this endpoint slow.
   */
  router.get('/home-assistant', (_req, res) => {
    res.json(
      options.homeAssistant?.() ?? { available: false, reason: 'not_configured', frost: null },
    );
  });

  /**
   * The plumbing behind the Settings page's status block.
   *
   * Read only, always `200`, and — like `/api/home-assistant` — deliberately not
   * a proxy: it reports what this server knows about its own integration, never
   * anything fetched from Supervisor during the request.
   *
   * It exists because "no frost banner" is the correct display both for a
   * healthy September and for an integration that has been quietly broken since
   * the last Home Assistant restart. Without somewhere to look, those are the
   * same blank screen.
   */
  router.get('/home-assistant/status', (_req, res) => {
    res.json(
      options.integrationStatus?.() ??
        ({
          configured: false,
          connected: false,
          reason: 'not_configured',
          weatherEntity: null,
          notifyService: null,
          sensors: [],
          // Reported even with no Home Assistant, because it is a property of
          // this process rather than of the integration — and it is the value
          // that explains a notification arriving at the wrong hour.
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          frostRisk: null,
          forecastObservedAt: null,
        } satisfies IntegrationStatusBody),
    );
  });

  /**
   * Her notification preferences.
   *
   * A **singleton**, not a collection: one object in, one object out, no array
   * anywhere. `GET` answers from the database, and `PUT` replaces all three
   * fields and answers with what was actually stored.
   *
   * ## Why there is no `If-Match` here
   *
   * Every collection write on this router refuses to proceed without a declared
   * version, and that is not inconsistency being tolerated — it is a different
   * hazard. `PUT /api/seeds` replaces a whole array, so a stale tab saving over
   * a newer one **destroys records**: the phone's two new harvests are simply
   * gone, with no error and no trace. That is worth a 409 and a reconcile.
   *
   * Settings is three independent scalars. The worst a lost update can do here
   * is revert a toggle she flipped on another tab a moment ago — visible on the
   * screen she is looking at, and one click to redo. Nothing is destroyed,
   * because there is nothing here to destroy.
   *
   * Adopting the machinery anyway would mean bending it out of shape. The
   * conflict contract is array-shaped: `VersionConflictBody` carries
   * `current: T[]` and a `collection: CollectionName`, and `collection_versions`
   * is keyed by that same union. Settings is neither, so it would take either
   * wrapping the object in a one-element array — a lie the client would have to
   * unwrap — or a second, parallel conflict body, which is a third pattern
   * nobody asked for. Both cost more than the problem.
   *
   * So: last write wins, deliberately. The response body is read back from the
   * database rather than echoed from the request, so what she gets back is
   * always what is actually stored.
   */
  router.get('/settings', (_req, res) => {
    res.json(readSettings(db));
  });

  router.put('/settings', requireJsonBody, (req, res) => {
    const result = validateSettings(req.body);

    if (!result.ok) {
      sendValidationError(res, result.issues);
      return;
    }

    // No `onGardenChanged` here: settings do not change a single number Home
    // Assistant publishes. Nor is there anything to tell the integration —
    // it re-reads these from the database on every poll, so a change is live
    // without a restart and without a notification from this handler.
    res.json(withTransaction(db, () => writeSettings(db, result.value)));
  });

  /**
   * The migration path off `localStorage`. His wife's phone and laptop each hold
   * a divergent copy; this takes one of them and makes it the server's truth.
   *
   * It **replaces**, it does not merge. Merging two divergent collections with no
   * per-record timestamps would mean guessing, and a wrong guess silently
   * resurrects deleted rows.
   *
   * No `If-Match` here, because first-run migration happens before the client has
   * ever read a version — there is nothing it could send. Instead the guard is
   * emptiness: import only runs into an empty garden. That keeps the one job it
   * exists for working, while making it impossible to wipe a season of real
   * records with a stale browser snapshot. Once there is data, the ordinary
   * versioned `PUT` is the way in.
   */
  router.post('/import', requireJsonBody, (req, res) => {
    const result = validateSnapshot(req.body);

    if (!result.ok) {
      sendValidationError(res, result.issues);
      return;
    }

    type ImportOutcome =
      | { ok: true; versions: Record<CollectionName, number> }
      | { ok: false; nonEmpty: CollectionName[]; versions: Record<CollectionName, number> };

    // Emptiness check and write share a transaction, so a write landing between
    // the two cannot slip past the guard.
    const outcome = withTransaction(db, (): ImportOutcome => {
      const existing = {
        seeds: listSeeds(db),
        beds: listBeds(db),
        harvests: listHarvests(db),
      };

      const nonEmpty = (Object.keys(existing) as CollectionName[]).filter(
        (name) => existing[name].length > 0,
      );

      if (nonEmpty.length > 0) {
        return { ok: false, nonEmpty, versions: readAllVersions(db) };
      }

      replaceSeeds(db, result.value.seeds);
      replaceBeds(db, result.value.beds);
      replaceHarvests(db, result.value.harvests);

      // Bump all three even though each was empty: a tab that read version 0
      // before the import must not then be able to write over it.
      return {
        ok: true,
        versions: {
          seeds: bumpVersion(db, 'seeds'),
          beds: bumpVersion(db, 'beds'),
          harvests: bumpVersion(db, 'harvests'),
        },
      };
    });

    if (!outcome.ok) {
      sendImportConflict(res, outcome.nonEmpty, tokenise(outcome.versions), {
        seeds: listSeeds(db),
        beds: listBeds(db),
        harvests: listHarvests(db),
      });
      return;
    }

    res.json({
      mode: 'replace',
      message:
        'Imported the snapshot into an empty garden. Nothing was merged, and nothing was ' +
        'overwritten: import only runs when the server holds no records. Use PUT from now on.',
      imported: {
        seeds: result.value.seeds.length,
        beds: result.value.beds.length,
        harvests: result.value.harvests.length,
      },
      versions: tokenise(outcome.versions),
    } satisfies ImportResultBody);

    // An import is the largest change the garden ever sees in one go.
    options.onGardenChanged?.();
  });

  /**
   * The wall clock, read ambiently.
   *
   * Deliberate, and the only two things it timestamps are a file's `exportedAt`
   * and a safety copy's `takenAt` — both of which are *descriptions of when
   * something happened*, where the real clock is the correct answer and an
   * injected one would be testing the injection. The tests bracket a request
   * with `Date.now()` on either side and assert the timestamp falls between,
   * which proves more than a frozen clock would.
   */
  const clock = (): Date => new Date();

  /**
   * Her whole garden, as one file she can keep.
   *
   * ## Why this exists at all
   *
   * Supervisor deletes `/data` when an add-on is uninstalled, with no
   * confirmation step. One mis-click in the add-on UI and every seed packet,
   * bed layout and harvest she has recorded is gone. Home Assistant's own
   * backups help only if somebody remembers to take one, and restoring from a
   * full backup to recover a single add-on's SQLite file is not a thing she can
   * do unaided. This endpoint is the thing she *can* do unaided.
   *
   * ## Why it is not `res.json`
   *
   * `res.json` writes one enormous line. A backup you cannot open and read is a
   * backup you cannot trust, and "is my garden actually in this file?" needs to
   * be answerable by double-clicking it. See `prettyJson` for the formatting
   * rule and why a bed's layout stays on one line per row.
   *
   * ## No `If-Match`, no ETag
   *
   * Reading cannot lose anything, and there is no sensible single version for a
   * document spanning three independently-versioned collections. The transaction
   * inside `buildDocument` is what makes the file coherent.
   */
  router.get('/export', (_req, res) => {
    const exportedAt = clock().toISOString();
    const document = buildDocument(db, exportedAt);

    res.set('Content-Disposition', `attachment; filename="${backupFilename(exportedAt)}"`);
    // Nothing here is cacheable: the next request must produce the current
    // garden, not the one a proxy or the ingress layer saw earlier.
    res.set('Cache-Control', 'no-store');

    // Recorded only once the response actually completed. A connection that
    // dropped mid-file produced no usable copy, and telling her she saved one
    // is exactly the sort of comfortable lie that makes a backup feature worse
    // than none at all.
    //
    // What this measures is honest but narrow: the file was produced and sent
    // in full. Whether she then kept it is not observable from here — no
    // browser reports whether a download was saved or cancelled.
    res.on('finish', () => {
      if (res.statusCode === 200) writeLastExportAt(db, exportedAt);
    });

    res.type('application/json').send(prettyJson(document));
  });

  /**
   * Replaces the garden from a file she picked.
   *
   * The dangerous one. Everything that makes it survivable is in
   * `backup/restore.ts`: one transaction, a safety copy taken on the way past,
   * and an unconditional bump of all three version counters so no other device
   * can push its pre-restore state back. That last point is the subtle one and
   * the reasoning is written out in full there.
   *
   * ## No `If-Match`
   *
   * Every collection `PUT` refuses to run without a declared version, because a
   * stale tab saving an array is indistinguishable from an accident. A restore
   * is the opposite: it is a deliberate, explicit instruction to discard what is
   * there, taken by someone who has just been shown what the file contains and
   * confirmed it. Requiring a precondition would mean requiring a successful
   * read of a garden that may be precisely what is broken — and this is the one
   * feature that has to work when things are going wrong.
   *
   * The protection is not a precondition, it is the safety copy plus the
   * confirm step in front of it.
   */
  router.post('/restore', requireJsonBody, (req, res) => {
    const result = validateBackupDocument(req.body);

    if (!result.ok) {
      if (result.kind === 'unsupported') {
        // 422: the syntax is fine and we understood it perfectly well. What we
        // cannot do is apply it.
        sendError(res, 422, 'unsupported_backup', result.message);
        return;
      }

      sendValidationError(res, result.issues);
      return;
    }

    const outcome = applyRestore(
      db,
      { snapshot: result.value.snapshot, settings: result.value.settings },
      clock().toISOString(),
    );

    const from = result.value.exportedAt
      ? ` saved on ${result.value.exportedAt.slice(0, 10)}`
      : '';

    res.json({
      mode: 'replace',
      message:
        `Restored your garden from the file${from}. It now holds ` +
        `${describeCounts(outcome.counts)}, counted by reading the database back after the ` +
        `change was saved. The garden as it was — ${describeCounts(outcome.safetyCopy.counts)} ` +
        `— was copied first and can be put back from Settings.`,
      restored: outcome.counts,
      replaced: outcome.safetyCopy.counts,
      settingsRestored: outcome.settingsRestored,
      versions: tokenise(outcome.versions),
      safetyCopy: outcome.safetyCopy,
    } satisfies RestoreResultBody);

    // After the response. Every published sensor is now wrong until this runs.
    options.onGardenChanged?.();
  });

  /**
   * What the Settings panel needs to describe the state of her backups.
   *
   * `lastExportAt` is stored server-side rather than per browser on purpose: a
   * per-device memory would tell her laptop "you have never saved a copy" the
   * day after she saved one from her phone, which is worse than saying nothing.
   */
  router.get('/backup/status', (_req, res) => {
    res.json({
      lastExportAt: readLastExportAt(db),
      counts: currentCounts(db),
      safetyCopies: listSafetyCopies(db),
    } satisfies BackupStatusBody);
  });

  /**
   * One safety copy, as a file.
   *
   * The in-app undo is the usual route, but a copy that only exists inside this
   * database does not survive the uninstall it was partly taken against. Being
   * able to pull it out as a file is what turns it from a convenience into a
   * backup.
   */
  router.get('/backup/safety-copies/:id', (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      sendError(
        res,
        400,
        'validation_failed',
        `${JSON.stringify(req.params.id)} is not a safety copy number.`,
      );
      return;
    }

    const copy = readSafetyCopy(db, id);

    if (!copy) {
      sendError(
        res,
        404,
        'not_found',
        `There is no safety copy number ${id}. Only the most recent few are kept, so an older ` +
          'one may have been pruned to make room.',
      );
      return;
    }

    res.set(
      'Content-Disposition',
      `attachment; filename="${backupFilename(copy.takenAt).replace('.json', '-before-restore.json')}"`,
    );
    res.set('Cache-Control', 'no-store');
    // Stored already-rendered, so what she downloads is byte-for-byte the
    // document that was captured — not a re-serialisation that might differ.
    res.type('application/json').send(copy.document);
  });

  router.use((req, res) => {
    sendError(res, 404, 'not_found', `No API route for ${req.method} ${req.originalUrl}`);
  });

  return router;
}