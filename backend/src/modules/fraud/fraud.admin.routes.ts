import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import { AlertStatus, Severity } from '../../generated/prisma/client.js'
import { authOf } from '../../middleware/auth.js'
import { parse } from '../../lib/validate.js'
import { appendAudit } from '../audit/audit.service.js'

const listSchema = z.object({
  status: z.enum(AlertStatus).optional(),
  severity: z.enum(Severity).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
const idSchema = z.object({ id: z.uuid() })
// Unlocking a LOCKED voter is a separate, explicit action on the voters page.
const reviewSchema = z.object({ status: z.enum(['REVIEWED', 'DISMISSED']) })

/** Mounted under /api/admin/fraud-alerts (role ADMIN). UC-11 Monitor Fraud Alerts. */
export function adminFraudRouter({ db }: Deps) {
  const router = Router()

  router.get('/', async (req, res) => {
    const { status, severity, page, pageSize } = parse(listSchema, req.query)
    const where = { ...(status && { status }), ...(severity && { severity }) }
    const [items, total, open] = await Promise.all([
      db.fraudAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          voter: { select: { id: true, name: true, cnic: true, status: true } },
          election: { select: { id: true, title: true } },
        },
      }),
      db.fraudAlert.count({ where }),
      db.fraudAlert.groupBy({
        by: ['severity'],
        where: { status: 'OPEN' },
        _count: { _all: true },
      }),
    ])
    const openBySeverity = Object.fromEntries(open.map((g) => [g.severity, g._count._all]))
    res.json({ items, total, page, pageSize, openBySeverity })
  })

  router.patch('/:id', async (req, res) => {
    const { id } = parse(idSchema, req.params)
    const { status } = parse(reviewSchema, req.body)
    const adminId = authOf(req).sub
    const updated = await db.$transaction(async (tx) => {
      const alert = await tx.fraudAlert.findUnique({ where: { id } })
      if (!alert) throw new ApiError(404, 'NOT_FOUND', 'Alert not found')
      const { count } = await tx.fraudAlert.updateMany({
        where: { id, status: 'OPEN' },
        data: { status, reviewedById: adminId, reviewedAt: new Date() },
      })
      if (count === 0) throw new ApiError(409, 'ALREADY_REVIEWED', 'This alert was already handled')
      await appendAudit(tx, {
        actorType: 'ADMIN',
        actorId: adminId,
        action: 'FRAUD_ALERT_REVIEWED',
        payload: { alertId: id, type: alert.type, to: status },
      })
      return tx.fraudAlert.findUniqueOrThrow({ where: { id } })
    })
    res.json(updated)
  })

  return router
}
