import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import { VoterStatus } from '../../generated/prisma/client.js'
import { authOf } from '../../middleware/auth.js'
import { parse } from '../../lib/validate.js'
import { appendAudit } from '../audit/audit.service.js'

const listSchema = z.object({
  status: z.enum(VoterStatus).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

const idSchema = z.object({ id: z.uuid() })

/** Which statuses each admin action may move a voter out of (UC-10, voter state diagram). */
const TRANSITIONS = {
  approve: { from: ['PENDING', 'SUSPENDED', 'LOCKED'], to: 'APPROVED', audit: 'VOTER_APPROVED' },
  suspend: { from: ['PENDING', 'APPROVED', 'LOCKED'], to: 'SUSPENDED', audit: 'VOTER_SUSPENDED' },
} as const satisfies Record<string, { from: VoterStatus[]; to: VoterStatus; audit: string }>

/** Mounted under /api/admin, which already requires role ADMIN. */
export function adminVotersRouter({ db }: Deps) {
  const router = Router()

  router.get('/', async (req, res) => {
    const { status, search, page, pageSize } = parse(listSchema, req.query)
    const where = {
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
          { cnic: { contains: search } },
        ],
      }),
    }
    const [items, total] = await Promise.all([
      db.voter.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, name: true, email: true, cnic: true, status: true, createdAt: true },
      }),
      db.voter.count({ where }),
    ])
    res.json({ items, total, page, pageSize })
  })

  for (const [action, rule] of Object.entries(TRANSITIONS)) {
    router.post(`/:id/${action}`, async (req, res) => {
      const { id } = parse(idSchema, req.params)
      const adminId = authOf(req).sub
      const updated = await db.$transaction(async (tx) => {
        const voter = await tx.voter.findUnique({ where: { id } })
        if (!voter) throw new ApiError(404, 'NOT_FOUND', 'Voter not found')
        if (!(rule.from as readonly VoterStatus[]).includes(voter.status)) {
          throw new ApiError(
            409,
            'INVALID_STATUS_TRANSITION',
            `Cannot ${action} a ${voter.status} voter`,
          )
        }
        const result = await tx.voter.update({
          where: { id },
          data: { status: rule.to, ...(rule.to === 'APPROVED' && { approvedById: adminId }) },
          select: { id: true, status: true },
        })
        await appendAudit(tx, {
          actorType: 'ADMIN',
          actorId: adminId,
          action: rule.audit,
          payload: { voterId: id, from: voter.status, to: rule.to },
        })
        return result
      })
      res.json(updated)
    })
  }

  return router
}
