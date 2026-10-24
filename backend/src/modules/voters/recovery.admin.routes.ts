import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import { authOf } from '../../middleware/auth.js'
import { parse } from '../../lib/validate.js'
import { appendAudit } from '../audit/audit.service.js'

const listSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
})
const idSchema = z.object({ id: z.uuid() })

/** Mounted under /api/admin/recovery-requests (role ADMIN). Lost-device recovery, brief §5.12. */
export function adminRecoveryRouter({ db }: Deps) {
  const router = Router()

  router.get('/', async (req, res) => {
    const { status } = parse(listSchema, req.query)
    const requests = await db.recoveryRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    const voters = await db.voter.findMany({
      where: { id: { in: requests.map((r) => r.voterId) } },
      select: { id: true, name: true, cnic: true, email: true, status: true },
    })
    const byId = new Map(voters.map((v) => [v.id, v]))
    res.json(requests.map((r) => ({ ...r, voter: byId.get(r.voterId) ?? null })))
  })

  // Approving revokes every existing credential; the voter's next face login then enrols the new device.
  for (const decision of ['approve', 'reject'] as const) {
    router.post(`/:id/${decision}`, async (req, res) => {
      const { id } = parse(idSchema, req.params)
      const adminId = authOf(req).sub
      const result = await db.$transaction(async (tx) => {
        const request = await tx.recoveryRequest.findUnique({ where: { id } })
        if (!request) throw new ApiError(404, 'NOT_FOUND', 'Recovery request not found')
        const { count } = await tx.recoveryRequest.updateMany({
          where: { id, status: 'PENDING' },
          data: {
            status: decision === 'approve' ? 'APPROVED' : 'REJECTED',
            decidedAt: new Date(),
            decidedById: adminId,
          },
        })
        if (count === 0)
          throw new ApiError(409, 'ALREADY_DECIDED', 'This request was already decided')
        let revoked = 0
        if (decision === 'approve') {
          ;({ count: revoked } = await tx.webAuthnCredential.updateMany({
            where: { voterId: request.voterId, revokedAt: null },
            data: { revokedAt: new Date() },
          }))
        }
        await appendAudit(tx, {
          actorType: 'ADMIN',
          actorId: adminId,
          action: decision === 'approve' ? 'RECOVERY_APPROVED' : 'RECOVERY_REJECTED',
          payload: { requestId: id, voterId: request.voterId, credentialsRevoked: revoked },
        })
        return {
          id,
          status: decision === 'approve' ? 'APPROVED' : 'REJECTED',
          credentialsRevoked: revoked,
        }
      })
      res.json(result)
    })
  }

  return router
}
