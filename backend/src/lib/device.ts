import type { Request, Response } from 'express'
import { randomToken, sha256 } from './crypto.js'

const DEVICE_COOKIE = 'did'
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

/**
 * deviceHash = SHA-256(random device id cookie + user agent). Lets fraud rules spot one device
 * used for many accounts. Not a strong identifier: clearing cookies gives a new hash.
 */
export function deviceHashOf(req: Request, res: Response): string {
  let id: string | undefined = req.cookies?.[DEVICE_COOKIE]
  if (!id || !/^[\w-]{20,64}$/.test(id)) {
    id = randomToken(24)
    res.cookie(DEVICE_COOKIE, id, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: ONE_YEAR_MS,
    })
  }
  return sha256(`${id}|${req.get('user-agent') ?? ''}`)
}

/** Request metadata stored on every AuthEvent. */
export function clientInfo(req: Request, res: Response) {
  return {
    ip: req.ip ?? 'unknown',
    userAgent: (req.get('user-agent') ?? '').slice(0, 500),
    deviceHash: deviceHashOf(req, res),
  }
}
