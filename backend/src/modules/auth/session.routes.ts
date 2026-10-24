import { Router } from 'express'
import type { Deps } from '../../app.js'
import { appendAudit } from '../audit/audit.service.js'
import { REFRESH_COOKIE, clearRefreshCookie, revokeSession, rotateSession } from './tokens.js'

/** Refresh and logout work for both roles; the refresh token row records whose it is. */
export function sessionRouter({ db, config }: Deps) {
  const router = Router()

  router.post('/refresh', async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE]
    const { accessToken, claims } = await rotateSession(db, config, res, presented)
    res.json({ accessToken, role: claims.role })
  })

  router.post('/logout', async (req, res) => {
    const revoked = await revokeSession(db, req.cookies?.[REFRESH_COOKIE])
    if (revoked) {
      await appendAudit(db, {
        actorType: revoked.role,
        actorId: revoked.subjectId,
        action: 'LOGOUT',
      })
    }
    clearRefreshCookie(res)
    res.status(204).end()
  })

  return router
}
