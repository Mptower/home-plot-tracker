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
import { withTransaction } from "../db/open.js";
import { listBeds, listHarvests, listSeeds, replaceBeds, replaceHarvests, replaceSeeds, } from "../db/collections.js";
import { readSettings, writeSettings } from "../db/settings.js";
import { bumpVersion, readAllVersions, readVersion, replaceIfCurrent } from "../db/versions.js";
import { appliedVersions } from "../db/migrate.js";
import { parseIfMatch, requireJsonBody, sendError, sendImportConflict, sendValidationError, sendVersionConflict, versionToken, } from "../http.js";
import { validateBeds, validateHarvests, validateSeeds, validateSettings, validateSnapshot, } from "../validation.js";
/** Bodies are three small arrays; 4 MB is roomy for a decade of harvests. */
const BODY_LIMIT = '4mb';
/** Counters -> entity tags, so every version leaves the server in the same form. */
function tokenise(versions) {
    return {
        seeds: versionToken(versions.seeds),
        beds: versionToken(versions.beds),
        harvests: versionToken(versions.harvests),
    };
}
const SEEDS = {
    name: 'seeds',
    path: '/seeds',
    read: listSeeds,
    replace: replaceSeeds,
    validate: validateSeeds,
};
const BEDS = {
    name: 'beds',
    path: '/beds',
    read: listBeds,
    replace: replaceBeds,
    validate: validateBeds,
};
const HARVESTS = {
    name: 'harvests',
    path: '/harvests',
    read: listHarvests,
    replace: replaceHarvests,
    validate: validateHarvests,
};
function mountCollection(router, db, endpoint, options) {
    /** Version and contents read together, so the ETag always describes the body beside it. */
    const readCurrent = () => withTransaction(db, () => ({
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
                message: ifMatch.kind === 'absent'
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
        const write = replaceIfCurrent(db, endpoint.name, ifMatch.version, result.value, endpoint.replace, endpoint.read);
        if (!write.ok) {
            sendVersionConflict(res, 409, endpoint.name, versionToken(write.currentVersion), write.current, {
                message: `The ${endpoint.name} collection changed since you loaded it, so saving would have ` +
                    `discarded that change. Nothing was saved. Reconcile your edit against "current" ` +
                    `and retry with the new version in If-Match.`,
                expectedVersion: versionToken(ifMatch.version),
            });
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
export function createApiRouter(db, options = {}) {
    const router = express.Router();
    router.use(express.json({
        limit: BODY_LIMIT,
        type: 'application/json',
        // `strict: false` so a scalar body like `42` or `"nope"` is parsed and then
        // rejected by the validator with "expected an array, received number".
        // Leaving it strict would report it as a JSON parse failure, which is
        // simply untrue and sends whoever is debugging an import in the wrong
        // direction.
        strict: false,
    }));
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
        res.json(options.homeAssistant?.() ?? { available: false, reason: 'not_configured', frost: null });
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
        res.json(options.integrationStatus?.() ??
            {
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
            });
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
        // Emptiness check and write share a transaction, so a write landing between
        // the two cannot slip past the guard.
        const outcome = withTransaction(db, () => {
            const existing = {
                seeds: listSeeds(db),
                beds: listBeds(db),
                harvests: listHarvests(db),
            };
            const nonEmpty = Object.keys(existing).filter((name) => existing[name].length > 0);
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
            message: 'Imported the snapshot into an empty garden. Nothing was merged, and nothing was ' +
                'overwritten: import only runs when the server holds no records. Use PUT from now on.',
            imported: {
                seeds: result.value.seeds.length,
                beds: result.value.beds.length,
                harvests: result.value.harvests.length,
            },
            versions: tokenise(outcome.versions),
        });
        // An import is the largest change the garden ever sees in one go.
        options.onGardenChanged?.();
    });
    router.use((req, res) => {
        sendError(res, 404, 'not_found', `No API route for ${req.method} ${req.originalUrl}`);
    });
    return router;
}
//# sourceMappingURL=api.js.map