export function sendError(res, status, error, message) {
    res.status(status).json({ error, message });
}
export function sendValidationError(res, issues) {
    const summary = issues.length === 1 ? '1 problem' : `${issues.length} problems`;
    res.status(400).json({
        error: 'validation_failed',
        message: `The submitted data was rejected (${summary}). Nothing was saved.`,
        issues,
    });
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
export function versionToken(version) {
    return `"${version}"`;
}
export function parseIfMatch(header) {
    if (header === undefined)
        return { kind: 'absent' };
    const raw = header.trim();
    if (raw === '')
        return { kind: 'absent' };
    if (raw === '*')
        return { kind: 'unusable', raw: header };
    // `W/"3"` -> `3`, `"3"` -> `3`, `3` -> `3`.
    const unwrapped = raw
        .replace(/^W\//i, '')
        .replace(/^"(.*)"$/, '$1')
        .trim();
    if (!/^\d+$/.test(unwrapped))
        return { kind: 'unusable', raw: header };
    const version = Number(unwrapped);
    if (!Number.isSafeInteger(version))
        return { kind: 'unusable', raw: header };
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
export function sendVersionConflict(res, status, collection, currentVersion, current, detail) {
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
    });
}
/**
 * `409` from import when the garden already holds data.
 *
 * Import is guarded by emptiness rather than by a version, because first-run
 * migration happens before the client has ever read one. Same field names as a
 * write conflict, generalised to maps because import spans all three
 * collections at once.
 */
export function sendImportConflict(res, nonEmpty, currentVersion, current) {
    res.status(409).json({
        error: 'import_not_empty',
        message: `This garden already has data (${nonEmpty.join(', ')}), so the import was refused and ` +
            'nothing was saved. Import only runs into an empty garden, because it replaces rather ' +
            'than merges. To bring these records in without losing what is already here, fold them ' +
            'into each collection and save it with a normal versioned PUT.',
        currentVersion,
        current,
        nonEmpty,
    });
}
/** Rejects a write whose body was never parsed because it was not sent as JSON. */
export const requireJsonBody = (req, res, next) => {
    if (!req.is('application/json')) {
        sendError(res, 415, 'unsupported_media_type', 'Content-Type must be application/json');
        return;
    }
    next();
};
/** One compact line per request, aimed at `journalctl`. */
export function requestLogger() {
    return (req, res, next) => {
        const startedAt = process.hrtime.bigint();
        res.on('finish', () => {
            const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
            console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
        });
        next();
    };
}
/**
 * Final error handler. Turns body-parser's own failures into the same JSON shape
 * as everything else, and refuses to leak internals in production.
 */
export function errorHandler(isProduction) {
    return (error, _req, res, next) => {
        if (res.headersSent) {
            next(error);
            return;
        }
        const candidate = error;
        if (candidate?.type === 'entity.parse.failed') {
            sendError(res, 400, 'malformed_json', 'Request body was not valid JSON');
            return;
        }
        if (candidate?.type === 'entity.too.large') {
            sendError(res, 413, 'payload_too_large', 'Request body is too large');
            return;
        }
        console.error('Unhandled request error:', error);
        sendError(res, 500, 'internal_error', isProduction
            ? 'Internal server error'
            : `Internal server error: ${candidate?.message ?? String(error)}`);
    };
}
//# sourceMappingURL=http.js.map