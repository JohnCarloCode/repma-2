import type { NextFunction, Request, Response } from 'express';

// architecture.md §3.2/§8 — typed AppError {status, code, message, details},
// consumed by the central error handler. The envelope it produces is the
// one documented in architecture.md §7: { error: { code, message, details? } }.
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));
}

// Express identifies error-handling middleware by arity (4 params) — `_next` must stay, unused.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      req.log?.error({ err }, err.message);
    }
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  req.log?.error({ err }, 'Unexpected error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
