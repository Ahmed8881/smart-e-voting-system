import type { RequestHandler } from 'express'
import type { Config } from '../config.js'
import { ApiError } from '../errors.js'
import type { Role } from '../generated/prisma/client.js'
import { type AuthClaims, verifyAccessToken } from '../modules/auth/tokens.js'

declare global {
  namespace Express {
    interface Request {
      auth?: AuthClaims
    }
  }
}

/** Requires a valid Bearer access token with the given role (RBAC). */
export function requireRole(config: Config, role: Role): RequestHandler {
  return (req, _res, next) => {
    const header = req.get('authorization')
    if (!header?.startsWith('Bearer ')) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Missing access token')
    }
    const claims = verifyAccessToken(config, header.slice('Bearer '.length))
    if (claims.role !== role) throw new ApiError(403, 'FORBIDDEN', 'Not allowed for this role')
    req.auth = claims
    next()
  }
}

/** For handlers mounted behind requireRole. */
export function authOf(req: { auth?: AuthClaims }): AuthClaims {
  if (!req.auth) throw new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated')
  return req.auth
}
