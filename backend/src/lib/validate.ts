import type { z } from 'zod'
import { ApiError } from '../errors.js'

/** Parses untrusted input at the API boundary; any failure becomes a 400 in the standard error shape. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    throw new ApiError(400, 'VALIDATION_ERROR', `${where}${issue?.message ?? 'Invalid input'}`)
  }
  return result.data
}
