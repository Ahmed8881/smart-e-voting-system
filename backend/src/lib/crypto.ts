import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const sha256 = (input: string) => createHash('sha256').update(input).digest('hex')

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

/** Constant-time comparison of two hex digests of equal length. */
export function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
