/**
 * Reading a backup file in the browser, before anything irreversible happens.
 *
 * Everything here is pure. No `fetch`, no DOM, no React — which is what lets it
 * be tested properly in a repository whose test runner is `node:test` with no
 * DOM at all.
 *
 * ## Why the browser parses the file at all
 *
 * The server validates every restore independently and is the only authority on
 * what may be applied; nothing here is a security boundary and nothing here is
 * trusted by the server. This exists for one reason: she must be able to see
 * what is in a file *before* it replaces her garden. "3 seed packets, 2 beds and
 * 14 harvests, saved on 14 September 2026" is a sentence she can check against
 * what she expects, and it has to appear before the confirm button, which means
 * it has to be computed here.
 *
 * A useful consequence: the file never reaches the server unless it parsed
 * here. So the cases that produce a bad file — a zero-byte download, a login
 * page saved under a `.json` name by a phone's download manager — are caught in
 * front of her with a sentence about what actually went wrong, rather than
 * arriving at the server as an unparseable body and coming back as "malformed
 * JSON".
 *
 * ## What this deliberately does not do
 *
 * It does not re-implement `server/src/validation.ts`. Checking every field in
 * two places means two validators that drift, and the one that drifts is always
 * the one guarding the more dangerous operation. This checks only enough to
 * count honestly and to refuse a file that is plainly not a garden; anything
 * subtler is the server's answer to give, and its refusals name the exact field.
 */
import type { CollectionName, GardenBackupDocument } from '../types';

/**
 * Identifies a file as ours. Must match `server/src/backup/format.ts`.
 *
 * Duplicated rather than imported from `@hpt/shared` because the server cannot
 * import a runtime value from that package — the add-on image ships no `shared/`
 * — so the constant cannot live in one shared place. `backup-parity.test.ts`
 * fails if the two copies drift.
 */
export const BACKUP_FORMAT = 'home-plot-tracker.garden';

/** The highest file format this build understands. */
export const BACKUP_FORMAT_VERSION = 1;

export type BackupCounts = Record<CollectionName, number>;

export interface BackupPreview {
  counts: BackupCounts;
  /** What the file says about when it was saved. `null` when it does not say. */
  exportedAt: string | null;
  includesSettings: boolean;
  /** Whether the file carried our format marker, rather than being a bare snapshot. */
  recognised: boolean;
  /** The parsed document, ready to be posted. */
  document: GardenBackupDocument;
  /** One sentence, for the confirm step. */
  summary: string;
}

export type BackupFileReview =
  | { ok: true; preview: BackupPreview }
  | { ok: false; message: string };

const COLLECTIONS: CollectionName[] = ['seeds', 'beds', 'harvests'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `2026-09-14T16:05:00Z` -> `14 September 2026`.
 *
 * Written out rather than left to `toLocaleDateString` so the same file reads
 * the same way on her phone and her laptop, and so a test can assert on it.
 * Falls back to the raw string: a date we cannot format is still information,
 * and losing it would be worse than showing it awkwardly.
 */
export function formatDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);

  if (!match) return iso;

  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];

  if (!name) return iso;

  return `${Number(day)} ${name} ${year}`;
}

/**
 * The name to suggest for the downloaded file.
 *
 * The server sends its own in `Content-Disposition`, and on Android that is the
 * one that wins — `URLUtil.guessFileName` reads the header. This exists for the
 * `download` attribute, which on iOS is the *only* thing that turns a link into
 * a download at all, and which then supplies the name itself.
 *
 * Built from the local date rather than UTC, so the file is named for the day
 * she pressed the button in her own kitchen. It can therefore differ by one day
 * from the server's name on the same click; that is cosmetic, the two never
 * appear together, and the file's own `exportedAt` is the authoritative answer.
 */
export function suggestedFilename(now: Date = new Date()): string {
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  return `home-plot-tracker-${day}.json`;
}

/** `3 seed packets, 2 beds and 14 harvests`. */
export function describeCounts(counts: BackupCounts): string {
  const parts = [
    `${counts.seeds} ${counts.seeds === 1 ? 'seed packet' : 'seed packets'}`,
    `${counts.beds} ${counts.beds === 1 ? 'bed' : 'beds'}`,
    `${counts.harvests} ${counts.harvests === 1 ? 'harvest' : 'harvests'}`,
  ];

  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * `You last saved a copy 3 weeks ago`, or the honest absence of one.
 *
 * Rounded down to whole units and never precise, because the number is only
 * there to prompt a habit. "23 days ago" invites arithmetic; "3 weeks ago"
 * invites saving a copy.
 */
export function describeAge(lastExportAt: string | null, now: Date = new Date()): string {
  if (!lastExportAt) return 'You have never saved a copy of your garden.';

  const at = Date.parse(lastExportAt);

  if (Number.isNaN(at)) return 'You have saved a copy before, but not recently.';

  const days = Math.floor((now.getTime() - at) / 86_400_000);

  if (days <= 0) return 'You saved a copy today.';
  if (days === 1) return 'You saved a copy yesterday.';
  if (days < 14) return `You last saved a copy ${days} days ago.`;
  if (days < 60) return `You last saved a copy ${Math.floor(days / 7)} weeks ago.`;

  return `You last saved a copy ${Math.floor(days / 30)} months ago, on ${formatDay(lastExportAt)}.`;
}

function countCollection(value: unknown): number | null {
  if (!Array.isArray(value)) return null;

  // Every record has an id. Checking that much is what makes the count
  // trustworthy — an array of strings would otherwise preview as "14 harvests"
  // and then be refused by the server, which is the wrong order to find out.
  return value.every((entry) => isRecord(entry) && typeof entry.id === 'string')
    ? value.length
    : null;
}

/**
 * Turns the text of a file into something she can be shown, or a refusal she
 * can act on.
 *
 * Every refusal here names the likely cause rather than the symptom. That is
 * the whole job: somebody reaching for a backup is already having a bad day,
 * and "Unexpected token < in JSON at position 0" is not a sentence that helps.
 */
export function reviewBackupFile(text: string): BackupFileReview {
  const trimmed = text.trim();

  if (trimmed === '') {
    // A zero-byte file is one of the two shapes a silently failed download
    // takes, and "unexpected end of input" is a terrible way to be told.
    return {
      ok: false,
      message:
        'This file is empty. The download may not have finished — try saving a copy again.',
    };
  }

  if (trimmed.startsWith('<')) {
    // The other shape: a download handed to a phone's download manager that
    // arrived without the Home Assistant session and saved a login page under a
    // .json name. The file exists, has a sensible name, and contains nothing.
    return {
      ok: false,
      message:
        'This looks like a web page rather than a garden backup. If it was downloaded on a ' +
        'phone, the download may have saved a sign-in page by mistake. Try saving a copy ' +
        'again, from a computer if you can.',
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      message:
        'This file is not readable as a garden backup. If you have edited it by hand, a ' +
        'missing comma or bracket will do this. Nothing has been changed.',
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      message: 'This file does not contain a garden. Nothing has been changed.',
    };
  }

  if (parsed.format !== undefined && parsed.format !== BACKUP_FORMAT) {
    return {
      ok: false,
      message:
        `This file says it belongs to ${JSON.stringify(String(parsed.format))}, not to ` +
        'The Home Plot Tracker. Nothing has been changed.',
    };
  }

  if (typeof parsed.formatVersion === 'number' && parsed.formatVersion > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      message:
        'This backup was saved by a newer version of The Home Plot Tracker than the one ' +
        'running here. Update the add-on and try again. Nothing has been changed.',
    };
  }

  const missing = COLLECTIONS.filter((name) => parsed[name] === undefined);

  if (missing.length === COLLECTIONS.length) {
    return {
      ok: false,
      message:
        'This file does not contain any seeds, beds or harvests, so it is not a garden ' +
        'backup. Nothing has been changed.',
    };
  }

  if (missing.length > 0) {
    // Not treated as "restore these as empty". A restore replaces everything,
    // so guessing here is the difference between keeping a season of records
    // and deleting them.
    return {
      ok: false,
      message:
        `This backup is incomplete — it has no ${missing.join(' or ')}. Restoring it would ` +
        'replace your whole garden, so a missing section cannot be treated as an empty one. ' +
        'Nothing has been changed.',
    };
  }

  const counts = {} as BackupCounts;

  for (const name of COLLECTIONS) {
    const count = countCollection(parsed[name]);

    if (count === null) {
      return {
        ok: false,
        message: `The ${name} in this file are not in a shape this app can read. Nothing has been changed.`,
      };
    }

    counts[name] = count;
  }

  const exportedAt = typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null;
  const saved = exportedAt ? `, saved on ${formatDay(exportedAt)}` : '';

  return {
    ok: true,
    preview: {
      counts,
      exportedAt,
      includesSettings: isRecord(parsed.settings),
      recognised: parsed.format === BACKUP_FORMAT,
      document: parsed as unknown as GardenBackupDocument,
      summary: `${describeCounts(counts)}${saved}`,
    },
  };
}

/**
 * What a restore is about to do, in one sentence, with the loss named.
 *
 * The count that gets lost is deliberately in the same sentence as the count
 * that arrives. A confirmation that only describes what she is gaining is not a
 * confirmation.
 */
export function describeRestore(incoming: BackupCounts, current: BackupCounts): string {
  return (
    `This will replace your garden — ${describeCounts(current)} — with ` +
    `${describeCounts(incoming)} from this file. A copy of what you have now will be saved ` +
    'first, so this can be undone.'
  );
}
