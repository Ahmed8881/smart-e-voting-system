import { Router } from 'express'
import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import { authOf, requireRole } from '../../middleware/auth.js'

/** Mounted at /api/me — the signed-in voter's own data. */
export function meRouter({ db, config }: Deps) {
  const router = Router()
  router.use(requireRole(config, 'VOTER'))

  router.get('/', async (req, res) => {
    const voter = await db.voter.findUnique({
      where: { id: authOf(req).sub },
      select: { id: true, name: true, email: true, status: true },
    })
    if (!voter) throw new ApiError(401, 'UNAUTHENTICATED', 'Account no longer exists')
    res.json(voter)
  })

  // UC-07: participation only — which elections and when, never the candidate (brief §5.8).
  router.get('/participation', async (req, res) => {
    const rows = await db.participation.findMany({
      where: { voterId: authOf(req).sub },
      orderBy: { votedAt: 'desc' },
      select: { votedAt: true, election: { select: { id: true, title: true, status: true } } },
    })
    res.json(rows.map((r) => ({ ...r.election, votedAt: r.votedAt })))
  })

  return router
}
