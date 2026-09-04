/**
 * The client half of the API contract.
 *
 * Every URL is built with `apiUrl` so the app keeps working at `/`, under a
 * reverse-proxy sub-path and behind Home Assistant ingress. There is no
 * absolute `/api/...` string anywhere in here, and there must never be one.
 *
 * Two things this module is careful about:
 *
 * 1. **Failures are classified, not stringified.** The UI says something
 *    different for "the server is not answering" than for "the server rejected
 *    this data", so the kind travels with the error rather than being guessed
 *    from a message later.
 * 2. **Versions travel with collections.** Whole-collection PUT plus two
 *    devices is a lost-update waiting to happen: the laptop reads at 9am, the
 *    phone writes at 2pm, and the laptop's save silently erases the phone's
 *    work. So a read carries a version and a write declares the version it was
 *    based on, which lets the server answer 409 instead of losing data.
 *
 * The contract, as settled with the server:
 *
 * - `GET` returns a bare array plus an `ETag`.
 * - `PUT` sends a bare array and declares `If-Match`. Success returns the stored
 *   array and a fresh `ETag`, so a save never needs a follow-up read.
 * - A stale `If-Match` answers `409`, and a missing one answers `428`. Both
 *   bodies carry `currentVersion` and the full `current` collection, so a
 *   reconcile costs one round trip rather than two.
 * - Versions are per collection and opaque: never parsed, compared or ordered,
 *   and copied into `If-Match` verbatim, quote marks included.
 * - Every error body is `{ error, message, ...extras }` where `error` is a
 *   machine code to branch on and `message` is the only part fit to display.
 *
 * The readers below also accept an envelope body and a handful of other field
 * names. That costs nothing and means a server that drifts from this in a small
 * way degrades to a slower path instead of a broken one.
 */
import { apiUrl } from './api';
import type { CollectionName, GardenSnapshot } from '../types';

/** A hung connection is indistinguishable from a dead one; stop waiting. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Mirrors `ValidationIssue` in `server/src/validation.ts`. */
export interface ApiIssue {
  path: string;
  message: string;
}

export type ApiFailureKind =
  /** The request never reached a server: offline, DNS, refused, timed out. */
  | 'network'
  /** The collection changed underneath us. Routine, not an error. */
  | 'stale'
  /** The server understood and refused: validation, 404, 415. */
  | 'rejected'
  /** The server broke. */
  | 'server'
  /** A 2xx whose body was not the shape the contract promises. */
  | 'malformed';

/** A collection plus the version the server knows it by. */
export interface Versioned<T> {
  items: T[];
  /** Opaque; `null` when the server does not (yet) version this collection. */
  version: string | null;
}

export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number;
  readonly issues: ApiIssue[];
  /** The underlying failure, when there was one. `Error.cause` in spirit. */
  readonly cause: unknown;
  /**
   * On a `stale` failure, the server's current state, when it sent one. The
   * items are `unknown` because only the caller knows which collection it
   * asked for; it narrows them by construction.
   */
  readonly remote: Versioned<unknown> | null;

  constructor(
    message: string,
    options: {
      kind: ApiFailureKind;
      status?: number;
      issues?: ApiIssue[];
      remote?: Versioned<unknown> | null;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status ?? 0;
    this.issues = options.issues ?? [];
    this.cause = options.cause ?? null;
    this.remote = options.remote ?? null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pulls an array out of a response body that may be the array itself or an
 * envelope around it. Written before the envelope exists so that adopting one
 * is a server-side change only.
 */
function readItems(body: unknown, collection: CollectionName): unknown[] | null {
  if (Array.isArray(body)) return body;

  if (isRecord(body)) {
    for (const key of ['items', collection, 'current', 'remote', 'server', 'data']) {
      const candidate = body[key];
      if (Array.isArray(candidate)) return candidate;
      // One level of nesting, e.g. { current: { version, items } }.
      if (isRecord(candidate) && Array.isArray(candidate.items)) return candidate.items;
    }
  }

  return null;
}

/** `ETag` header first, then a version field anywhere obvious in the body. */
function readVersion(response: Response | null, body: unknown): string | null {
  const etag = response?.headers.get('etag');
  if (etag) return etag;

  const candidates: unknown[] = [body];

  if (isRecord(body)) {
    for (const key of ['current', 'remote', 'server']) {
      if (isRecord(body[key])) candidates.push(body[key]);
    }
  }

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const version =
      candidate.currentVersion ?? candidate.version ?? candidate.etag ?? candidate.revision;
    if (typeof version === 'string' && version !== '') return version;
    if (typeof version === 'number' && Number.isFinite(version)) return String(version);
  }

  return null;
}

function readIssues(body: unknown): ApiIssue[] {
  if (!isRecord(body) || !Array.isArray(body.issues)) return [];

  return body.issues.flatMap((issue) =>
    isRecord(issue) && typeof issue.path === 'string' && typeof issue.message === 'string'
      ? [{ path: issue.path, message: issue.message }]
      : [],
  );
}

/** `error` is a machine code — `version_mismatch`, `import_not_empty` and so on. */
function looksLikeCode(value: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(value);
}

/**
 * The machine code to branch on, never to display.
 */
export function readErrorCode(body: unknown): string | null {
  if (!isRecord(body)) return null;

  const code = body.error;

  return typeof code === 'string' && looksLikeCode(code) ? code : null;
}

/**
 * The sentence to show the user: always `message` in the settled contract.
 *
 * `error` is only consulted when it holds prose rather than a machine code,
 * which is how phase 1's server worded its 400s. A code is never shown to
 * anyone — "version_mismatch" is not something to put in front of a gardener.
 */
function readServerMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;

  const message = body.message;
  if (typeof message === 'string' && message.trim() !== '') return message;

  const error = body.error;
  if (typeof error === 'string' && error.trim() !== '' && !looksLikeCode(error)) return error;

  return null;
}

interface RawResponse {
  response: Response;
  body: unknown;
}

/**
 * One request, with a timeout, JSON parsed defensively. Only transport-level
 * problems throw here; a non-2xx response is returned so each caller can decide
 * what a given status means to it (a 409 on a write is routine, for instance).
 */
async function send(path: string, init: RequestInit = {}): Promise<RawResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(apiUrl(path), {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...init.headers },
      // Ingress authenticates with the Home Assistant session cookie.
      credentials: 'same-origin',
    });
  } catch (cause) {
    throw new ApiError(
      controller.signal.aborted
        ? 'The garden server took too long to answer.'
        : 'Could not reach the garden server.',
      { kind: 'network', cause },
    );
  } finally {
    clearTimeout(timeout);
  }

  // A body is optional and may not be JSON at all — a proxy error page, say.
  let body: unknown = null;

  const text = await response.text().catch(() => '');

  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  return { response, body };
}

function failureFor(response: Response, body: unknown, fallback: string): ApiError {
  const message = readServerMessage(body) ?? fallback;

  if (response.status >= 500) {
    return new ApiError(message, { kind: 'server', status: response.status });
  }

  return new ApiError(message, {
    kind: 'rejected',
    status: response.status,
    issues: readIssues(body),
  });
}

/** Reads a collection and the version the server knows it by. */
export async function fetchCollection<T>(collection: CollectionName): Promise<Versioned<T>> {
  const { response, body } = await send(collection);

  if (!response.ok) {
    throw failureFor(response, body, `The garden server could not send your ${collection}.`);
  }

  const items = readItems(body, collection);

  if (!items) {
    throw new ApiError(`The garden server sent something unexpected for ${collection}.`, {
      kind: 'malformed',
      status: response.status,
    });
  }

  return { items: items as T[], version: readVersion(response, body) };
}

/**
 * Replaces a collection, declaring the version it was based on.
 *
 * A 409 (stale precondition) or a 428 (a server that requires one we did not
 * have) becomes an `ApiError` of kind `stale`, carrying the server's current
 * state so the caller can merge without a second request. 412 is accepted as a
 * synonym for 409 because it is the other conventional answer to `If-Match`.
 */
export async function saveCollection<T>(
  collection: CollectionName,
  items: readonly T[],
  version: string | null,
): Promise<Versioned<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Omitted rather than sent as `*` when unknown: `If-Match: *` means "any
  // existing version", which is the clobber this exists to prevent.
  if (version !== null) headers['If-Match'] = version;

  const { response, body } = await send(collection, {
    method: 'PUT',
    headers,
    body: JSON.stringify(items),
  });

  if (response.status === 409 || response.status === 412 || response.status === 428) {
    const remoteItems = readItems(body, collection);

    throw new ApiError('This collection changed on another device.', {
      kind: 'stale',
      status: response.status,
      remote: remoteItems ? { items: remoteItems, version: readVersion(response, body) } : null,
    });
  }

  if (!response.ok) {
    throw failureFor(response, body, `The garden server would not save your ${collection}.`);
  }

  const stored = readItems(body, collection);

  if (!stored) {
    throw new ApiError(`The garden server sent something unexpected for ${collection}.`, {
      kind: 'malformed',
      status: response.status,
    });
  }

  return { items: stored as T[], version: readVersion(response, body) };
}

export interface ImportSummary {
  imported: { seeds: number; beds: number; harvests: number };
  replaced: { seeds: number; beds: number; harvests: number };
  message: string;
}

/** One opaque version token per collection, as `import` hands back. */
export type GardenVersions = Record<CollectionName, string | null>;

const COLLECTION_NAMES: CollectionName[] = ['seeds', 'beds', 'harvests'];

const NO_VERSIONS: GardenVersions = { seeds: null, beds: null, harvests: null };

/**
 * `import` only lands on a completely empty garden. Finding records already
 * there is an ordinary thing to discover — the laptop added one bed while she
 * was looking around — so it is a result, not a thrown failure.
 *
 * It is emphatically *not* a version conflict: the guard is emptiness, so
 * retrying fails identically forever. The body says so in a different shape,
 * carrying every collection's current state, which is exactly what is needed to
 * merge instead.
 */
export type ImportOutcome =
  | { status: 'imported'; summary: ImportSummary; versions: GardenVersions }
  | {
      status: 'server-not-empty';
      message: string;
      /** Which collections already hold records. */
      nonEmpty: CollectionName[];
      /** Everything the server holds right now, ready to merge into. */
      current: Record<CollectionName, Versioned<unknown>>;
    };

function readCounts(value: unknown): { seeds: number; beds: number; harvests: number } {
  const counts = { seeds: 0, beds: 0, harvests: 0 };

  if (isRecord(value)) {
    for (const key of ['seeds', 'beds', 'harvests'] as const) {
      const count = value[key];
      if (typeof count === 'number' && Number.isFinite(count)) counts[key] = count;
    }
  }

  return counts;
}

/** `{ seeds: '"2"', beds: '"1"', ... }`. Tokens are copied verbatim, quotes and all. */
function readVersions(value: unknown): GardenVersions {
  const versions: GardenVersions = { ...NO_VERSIONS };

  if (isRecord(value)) {
    for (const key of COLLECTION_NAMES) {
      const token = value[key];
      if (typeof token === 'string' && token !== '') versions[key] = token;
    }
  }

  return versions;
}

/** The per-collection `current` / `currentVersion` pair of an `import_not_empty` body. */
function readGardenState(body: unknown): Record<CollectionName, Versioned<unknown>> {
  const current = isRecord(body) ? body.current : null;
  const versions = readVersions(isRecord(body) ? body.currentVersion : null);

  const state = {} as Record<CollectionName, Versioned<unknown>>;

  for (const name of COLLECTION_NAMES) {
    const items = isRecord(current) && Array.isArray(current[name]) ? current[name] : null;
    state[name] = { items: items ?? [], version: versions[name] };
  }

  return state;
}

function readNonEmpty(body: unknown): CollectionName[] {
  const listed = isRecord(body) && Array.isArray(body.nonEmpty) ? body.nonEmpty : [];

  return COLLECTION_NAMES.filter((name) => listed.includes(name));
}

/** Hands the server a whole garden at once. The migration path off localStorage. */
export async function importGarden(snapshot: GardenSnapshot): Promise<ImportOutcome> {
  const { response, body } = await send('import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });

  // `import_not_empty` is the only 409 this endpoint has; a code from some other
  // future guard is left to fall through to the ordinary rejection path.
  if (response.status === 409 && (readErrorCode(body) ?? 'import_not_empty') === 'import_not_empty') {
    return {
      status: 'server-not-empty',
      message: readServerMessage(body) ?? 'Your garden server already holds some records.',
      nonEmpty: readNonEmpty(body),
      current: readGardenState(body),
    };
  }

  if (!response.ok) {
    throw failureFor(response, body, 'The garden server would not accept that import.');
  }

  return {
    status: 'imported',
    summary: {
      imported: readCounts(isRecord(body) ? body.imported : null),
      replaced: readCounts(isRecord(body) ? body.replaced : null),
      message: isRecord(body) && typeof body.message === 'string' ? body.message : '',
    },
    versions: readVersions(isRecord(body) ? body.versions : null),
  };
}
