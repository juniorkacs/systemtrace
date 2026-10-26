export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string, id: string) => new HttpError(404, `${what} ${id} does not exist.`);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
