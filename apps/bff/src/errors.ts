/**
 * Error raised by the backend adapters on a non-2xx HTTP response. Carries the
 * upstream status (so the API can propagate 429 / 404) and the `Retry-After`
 * header when present, without leaking adapter internals to clients.
 */
export class BackendHttpError extends Error {
  constructor(
    readonly backend: string,
    readonly status: number,
    readonly retryAfter: string | null,
    message: string,
  ) {
    super(message);
    this.name = "BackendHttpError";
  }
}
