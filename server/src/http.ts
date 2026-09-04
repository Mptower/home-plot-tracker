/**
 * Shared HTTP shapes so every failure looks the same to the client.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ValidationIssue } from './validation.ts';

export interface ErrorBody {
  error: string;
  issues?: ValidationIssue[];
}

export function sendError(res: Response, status: number, error: string): void {
  res.status(status).json({ error } satisfies ErrorBody);
}

export function sendValidationError(res: Response, issues: ValidationIssue[]): void {
  const summary = issues.length === 1 ? '1 problem' : `${issues.length} problems`;

  res.status(400).json({
    error: `The submitted data was rejected (${summary}). Nothing was saved.`,
    issues,
  } satisfies ErrorBody);
}

/** Rejects a write whose body was never parsed because it was not sent as JSON. */
export const requireJsonBody: RequestHandler = (req, res, next) => {
  if (!req.is('application/json')) {
    sendError(res, 415, 'Content-Type must be application/json');
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
      sendError(res, 400, 'Request body was not valid JSON');
      return;
    }
    if (candidate?.type === 'entity.too.large') {
      sendError(res, 413, 'Request body is too large');
      return;
    }

    console.error('Unhandled request error:', error);

    sendError(
      res,
      500,
      isProduction
        ? 'Internal server error'
        : `Internal server error: ${candidate?.message ?? String(error)}`,
    );
  };
}
