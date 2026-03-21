export class HttpError extends Error {
  constructor(status, error, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.error = error;
  }
}

export function isHttpError(error) {
  return error instanceof HttpError;
}
