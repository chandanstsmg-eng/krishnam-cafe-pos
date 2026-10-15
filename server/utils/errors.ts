/**
 * An error whose message is safe to show to staff. Anything else that reaches
 * the error handler is logged and replaced with a generic friendly message.
 */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) => new AppError(400, msg, 'BAD_REQUEST', fields);
export const notFound = (what = 'Record') => new AppError(404, `${what} not found.`, 'NOT_FOUND');
export const forbidden = (msg = 'You do not have permission to do this.') => new AppError(403, msg, 'FORBIDDEN');
export const conflict = (msg: string) => new AppError(409, msg, 'CONFLICT');
export const approvalNeeded = (msg = 'Manager approval is needed for this.') => new AppError(403, msg, 'APPROVAL_REQUIRED');
