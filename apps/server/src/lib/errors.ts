export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'unauthenticated', message);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError(403, 'forbidden', message);
/** Used for resources in homes the caller cannot access — avoids leaking existence. */
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found.`);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const reauthRequired = () => new AppError(403, 'reauth_required', 'Please confirm your password to continue.');
export const confirmationRequired = (message: string) => new AppError(428, 'confirmation_required', message);
