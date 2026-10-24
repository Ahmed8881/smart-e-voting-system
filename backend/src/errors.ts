/** Thrown by handlers; rendered as { error: { code, message } } with the given HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
