import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

/** Wrap async route handlers so rejections reach the error handler. */
export function ah<R extends Request = Request>(fn: (req: R, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req as R, res, next).catch(next);
  };
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new AppError(400, 'validation_error', first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input.', r.error.flatten());
  }
  return r.data;
}

/**
 * CSRF defence: state-changing requests must carry a custom header. Browsers
 * cannot add custom headers to cross-site form posts, and cross-origin fetches
 * with them require a CORS preflight that our CORS policy rejects.
 * Combined with SameSite=Lax session cookies.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-smartnest-csrf') !== '1') return next(new AppError(403, 'csrf_failed', 'Missing request verification header.'));
  next();
};

const limiter = (windowMs: number, limit: number, keyByUser = false) =>
  rateLimit({
    windowMs,
    limit: config.isTest ? 10_000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByUser ? (req) => req.auth?.userId ?? req.ip ?? 'anon' : undefined,
    handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' } }),
  });

export const authLimiter = limiter(15 * 60_000, 20);
export const apiLimiter = limiter(60_000, 600);
export const commandLimiter = limiter(60_000, 120, true);

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
};

/** Never leaks stack traces or internal messages to clients. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details && err.status < 500 ? { details: err.details } : {}) } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'validation_error', message: 'Invalid input.', details: err.flatten() } });
    return;
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'Request is too large.' } });
    return;
  }
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body.' } });
    return;
  }
  logger.error({ err: { message: (err as Error).message, stack: (err as Error).stack }, path: req.path, method: req.method }, 'Unhandled error');
  // eslint-disable-next-line no-console
  if (config.isTest && process.env.DEBUG_TEST_ERRORS) console.error(err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.' } });
};
