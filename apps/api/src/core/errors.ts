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
// body-parser (express.json/urlencoded) rejects before any route runs; its errors carry a `type`.
function fromBodyParser(err: unknown): AppError | undefined {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
  if (type === 'entity.parse.failed') return new AppError(400, 'VALIDATION_ERROR', 'The request body is not valid JSON');
  return undefined;
}

export function errorHandler(caught: unknown, req: Request, res: Response, _next: NextFunction): void {
  const err = fromBodyParser(caught) ?? caught;
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
