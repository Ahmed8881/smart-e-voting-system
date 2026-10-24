import type { Response } from 'express'
import jwt from 'jsonwebtoken'
import type { Config } from '../../config.js'
import type { Db } from '../../db.js'
import { ApiError } from '../../errors.js'
import type { Role } from '../../generated/prisma/client.js'
import { randomToken, sha256 } from '../../lib/crypto.js'
import { appendAudit } from '../audit/audit.service.js'

export type AuthClaims = { sub: string; role: Role }

export const REFRESH_COOKIE = 'rt'
const ACCESS_TTL = '15m'
const ISSUER = 'evoting'
// Distinct audiences so a face-step token can never be used as an API access token, or vice versa.
const ACCESS_AUDIENCE = 'api'
const FACE_AUDIENCE = 'voter-face-step'
const FACE_TTL = '5m'
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/auth',
} as const

export function signAccessToken(config: Config, claims: AuthClaims) {
  return jwt.sign({ role: claims.role }, config.JWT_ACCESS_SECRET, {
    subject: claims.sub,
    expiresIn: ACCESS_TTL,
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE,
    algorithm: 'HS256',
  })
}

export function verifyAccessToken(config: Config, token: string): AuthClaims {
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: ACCESS_AUDIENCE,
    })
    if (typeof payload === 'string' || !payload.sub || !['ADMIN', 'VOTER'].includes(payload.role)) {
      throw new Error('bad claims')
    }
    return { sub: payload.sub, role: payload.role as Role }
  } catch {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid or expired access token')
  }
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS)
}

/** Issues an access token (returned) and a new refresh token (set as an httpOnly cookie). */
export async function issueSession(db: Db, config: Config, res: Response, claims: AuthClaims) {
  const refresh = randomToken()
  const ttlMs = config.REFRESH_TOKEN_TTL_DAYS * 86_400_000
  await db.refreshToken.create({
    data: {
      tokenHash: sha256(refresh),
      role: claims.role,
      subjectId: claims.sub,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  })
  res.cookie(REFRESH_COOKIE, refresh, { ...COOKIE_OPTIONS, maxAge: ttlMs })
  return signAccessToken(config, claims)
}

/**
 * Rotates a refresh token. Presenting an already-rotated token means it was stolen or replayed,
 * so every session of that subject is revoked.
 */
export async function rotateSession(
  db: Db,
  config: Config,
  res: Response,
  presented: string | undefined,
) {
  const invalid = new ApiError(401, 'UNAUTHENTICATED', 'Session expired, please log in again')
  if (!presented) throw invalid

  const stored = await db.refreshToken.findUnique({ where: { tokenHash: sha256(presented) } })
  if (!stored || stored.expiresAt < new Date()) throw invalid

  // Conditional update: of two concurrent refreshes with the same token, only one can win.
  const { count } = await db.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (count === 0) {
    await db.refreshToken.updateMany({
      where: { role: stored.role, subjectId: stored.subjectId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await appendAudit(db, {
      actorType: stored.role,
      actorId: stored.subjectId,
      action: 'REFRESH_TOKEN_REUSE_DETECTED',
    })
    clearRefreshCookie(res)
    throw invalid
  }

  const claims = { sub: stored.subjectId, role: stored.role }
  return { claims, accessToken: await issueSession(db, config, res, claims) }
}

/** Revokes the presented refresh token, if any. Returns its row for auditing. */
export async function revokeSession(db: Db, presented: string | undefined) {
  if (!presented) return null
  const stored = await db.refreshToken.findUnique({ where: { tokenHash: sha256(presented) } })
  if (!stored || stored.revokedAt) return null
  await db.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } })
  return stored
}

/** What the voter may do after passing the face step. */
export type FaceStepNext = 'WEBAUTHN_LOGIN' | 'WEBAUTHN_ENROL'

/** Proof that the voter just passed face + liveness (first factor). Valid 5 minutes. */
export function signFaceToken(config: Config, voterId: string, next: FaceStepNext) {
  return jwt.sign({ next }, config.JWT_ACCESS_SECRET, {
    subject: voterId,
    expiresIn: FACE_TTL,
    issuer: ISSUER,
    audience: FACE_AUDIENCE,
    algorithm: 'HS256',
  })
}

export function verifyFaceToken(config: Config, token: unknown, expected: FaceStepNext): string {
  try {
    if (typeof token !== 'string') throw new Error('missing')
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: FACE_AUDIENCE,
    })
    if (typeof payload === 'string' || !payload.sub || payload.next !== expected) {
      throw new Error('wrong step')
    }
    return payload.sub
  } catch {
    throw new ApiError(401, 'FACE_STEP_REQUIRED', 'Please verify your face again')
  }
}
