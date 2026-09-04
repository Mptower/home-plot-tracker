/**
 * Every failure looks the same to the client.
 *
 * One shape for all of them: `error` is a stable machine-readable code, and
 * `message` is prose for a human. Splitting the two matters because a caller
 * that branches on prose breaks the moment the wording is improved, and a
 * caller that displays a code shows the user something meaningless. Extra
 * fields hang off the same object — `issues` on a validation failure,
 * `current`/`currentVersion` on a concurrency one.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type {
  CollectionName,
  GardenSnapshot,
  ImportConflictBody,
  VersionConflictBody,
  VersionToken,
} from '@hpt/shared';
import type { ValidationIssue } from './validation.ts';

/** Stable codes. Add to this union rather than inventing strings at call sites. */
export type ApiErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'unsupported_media_type'
  | 'malformed_json'
  | 'payload_too_large'
  | 'internal_error';

export interface ErrorBody {
  error: ApiErrorCode;
  message: string;
  issues?: ValidationIssue[];
}

export function sendError(
  res: Response,
  status: number,
  error: ApiErrorCode,
  message: string,
): void {
  res.status(status).json({ error, message } satisfies ErrorBody);
}

export function sendValidationError(res: Response, issues: ValidationIssue[]): void {
  const summary = issues.length === 1 ? '1 problem' : `${issues.length} problems`;

  res.status(400).json({
    error: 'validation_failed',
    message: `The submitted data was rejected (${summary}). Nothing was saved.`,
    issues,
  } satisfies ErrorBody);
}

/**
 * Formats a stored counter as an HTTP entity tag: `3` -> `"3"`.
 *
 * Strong rather than weak, because the version changes on every write, so two
 * responses carrying the same tag really are byte-identical. That also makes
 * conditional `GET` work for free — a phone polling with `If-None-Match` gets a
 * 304 and no body.
 *
 * The quotes are part of the token. Clients treat the whole thing as opaque and
 * echo it back verbatim, which is why `currentVersion` in an error body is the
 * quoted form too: it can be dropped straight into `If-Match`.
 */
export function versionToken(version: number): VersionToken {
  return `"${version}"`;
}

/**
 * Parses `If-Match` back into the stored counter.
 *
 * Tolerant on input, strict on output. The idiomatic client echoes the `ETag` it
 * was given (`"3"`), but a bare `3` from a hand-written request, or a weak
 * `W/"3"` introduced by a proxy, mean the same thing — refusing them would make
 * the API harder to use from `curl` without making it any safer.
 *
 * `*` is deliberately **not** honoured. It means "any current representation",
 * and a collection always has one, so it would always pass — an unconditional
 * overwrite wearing a precondition's clothes. Refusing it keeps "I checked" and
 * "I did not check" distinguishable, which is the entire point of the header.
 */
export type IfMatch =
  | { kind: 'version'; version: number }
  | { kind: 'absent' }
  | { kind: 'unusable'; raw: string };

export function parseIfMatch(header: string | undefined): IfMatch {
  if (header === undefined) return { kind: 'absent' };

  const raw = header.trim();

  if (raw === '') return { kind: 'absent' };
  if (raw === '*') return { kind: 'unusable', raw: header };

  // `W/"3"` -> `3`, `"3"` -> `3`, `3` -> `3`.
  const unwrapped = raw
    .replace(/^W\//i, '')
    .replace(/^"(.*)"$/, '$1')
    .trim();

  if (!/^\d+$/.test(unwrapped)) return { kind: 'unusable', raw: header };

  const version = Number(unwrapped);

  if (!Number.isSafeInteger(version)) return { kind: 'unusable', raw: header };

  return { kind: 'version', version };
}

/**
 * `409` (stale write) and `428` (no usable precondition) share a body, because a
 * client recovers from both the same way: reconcile against `current`, retry
 * with `currentVersion`. Both carry the full current collection so that takes
 * one round trip rather than two.
 *
 * `428 Precondition Required` (RFC 6585) rather than 409 for a missing `If-Match`
 * because nothing actually conflicted — the client simply never asked. Calling
 * that a conflict would be a lie about a version it never held.
 */
export function sendVersionConflict<T>(
  res: Response,
  status: 409 | 428,
  collection: CollectionName,
  currentVersion: VersionToken,
  current: T[],
  detail: { message: string; expectedVersion?: VersionToken },
): void {
  res
    .status(status)
    .set('ETag', currentVersion)
    .json({
      error: status === 409 ? 'version_mismatch' : 'precondition_required',
      message: detail.message,
      currentVersion,
      current,
      collection,
      ...(detail.expectedVersion === undefined ? {} : { expectedVersion: detail.expectedVersion }),
    } satisfies VersionConflictBody<T>);
}

/**
 * `409` from import when the garden already holds data.
 *
 * Import is guarded by emptiness rather than by a version, because first-run
 * migration happens before the client has ever read one. Same field names as a
 * write conflict, generalised to maps because import spans all three
 * collections at once.
 */
export function sendImportConflict(
  res: Response,
  nonEmpty: CollectionName[],
  currentVersion: Record<CollectionName, VersionToken>,
  current: GardenSnapshot,
): void {
  res.status(409).json({
    error: 'import_not_empty',
    message:
      `This garden already has data (${nonEmpty.join(', ')}), so the import was refused and ` +
      'nothing was saved. Import only runs into an empty garden, because it replaces rather ' +
      'than merges. To bring these records in without losing what is already here, fold them ' +
      'into each collection and save it with a normal versioned PUT.',
    currentVersion,
    current,
    nonEmpty,
  } satisfies ImportConflictBody);
}

/** Rejects a write whose body was never parsed because it was not sent as JSON. */
export const requireJsonBody: RequestHandler = (req, res, next) => {
  if (!req.is('application/json')) {
    sendError(res, 415, 'unsupported_media_type', 'Content-Type must be application/json');
    return;
  }

  next();
};

/** One compact line per request, aimed at `journalctl`. */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });

    next();
  };
}

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

/**
 * Final error handler. Turns body-parser's own failures into the same JSON shape
 * as everything else, and refuses to leak internals in production.
 */
export function errorHandler(isProduction: boolean) {
  return (error: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const candidate = error as BodyParserError;

    if (candidate?.type === 'entity.parse.failed') {
      sendError(res, 400, 'malformed_json', 'Request body was not valid JSON');
      return;
    }
    if (candidate?.type === 'entity.too.large') {
      sendError(res, 413, 'payload_too_large', 'Request body is too large');
      return;
    }

    console.error('Unhandled request error:', error);

    sendError(
      res,
      500,
      'internal_error',
      isProduction
        ? 'Internal server error'
        : `Internal server error: ${candidate?.message ?? String(error)}`,
    );
  };
}

