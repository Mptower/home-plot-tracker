export function sendError(res, status, error) {
    res.status(status).json({ error });
}
export function sendValidationError(res, issues) {
    const summary = issues.length === 1 ? '1 problem' : `${issues.length} problems`;
    res.status(400).json({
        error: `The submitted data was rejected (${summary}). Nothing was saved.`,
        issues,
    });
}
/** Rejects a write whose body was never parsed because it was not sent as JSON. */
export const requireJsonBody = (req, res, next) => {
    if (!req.is('application/json')) {
        sendError(res, 415, 'Content-Type must be application/json');
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
            sendError(res, 400, 'Request body was not valid JSON');
            return;
        }
        if (candidate?.type === 'entity.too.large') {
            sendError(res, 413, 'Request body is too large');
            return;
        }
        console.error('Unhandled request error:', error);
        sendError(res, 500, isProduction
            ? 'Internal server error'
            : `Internal server error: ${candidate?.message ?? String(error)}`);
    };
}
//# sourceMappingURL=http.js.map