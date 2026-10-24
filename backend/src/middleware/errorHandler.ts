import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ApiError } from '../errors.js'

export const notFound: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`))
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } })
    return
  }
  // express.json() raises a SyntaxError with status 400 on malformed bodies.
  if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } })
    return
  }
  if (err?.type === 'entity.too.large') {
    res
      .status(413)
      .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } })
    return
  }
  // Never leak internals to the client; log only the message, not request data.
  console.error('Unhandled error:', err instanceof Error ? err.message : err)
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
}
