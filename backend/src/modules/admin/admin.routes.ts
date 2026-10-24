import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import { authOf, requireRole } from '../../middleware/auth.js'
import { parse } from '../../lib/validate.js'
import { appendAudit, verifyChain } from '../audit/audit.service.js'
import { adminElectionsRouter } from '../elections/elections.admin.routes.js'
import { SETTINGS, getSettings, isSettingKey } from '../settings/settings.js'
import { adminRecoveryRouter } from '../voters/recovery.admin.routes.js'
import { adminVotersRouter } from '../voters/voters.admin.routes.js'

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

const settingsUpdateSchema = z.record(z.string(), z.union([z.number(), z.string()]))

/** Everything under /api/admin requires role ADMIN. */
export function adminRouter(deps: Deps) {
  const { db, config } = deps
  const router = Router()
  router.use(requireRole(config, 'ADMIN'))
  router.use('/voters', adminVotersRouter(deps))
  router.use('/recovery-requests', adminRecoveryRouter(deps))
  router.use('/elections', adminElectionsRouter(deps))

  router.get('/me', async (req, res) => {
    const admin = await db.admin.findUnique({
      where: { id: authOf(req).sub },
      select: { id: true, name: true, email: true },
    })
    if (!admin) throw new ApiError(401, 'UNAUTHENTICATED', 'Account no longer exists')
    res.json(admin)
  })

  // UC-12: view logs
  router.get('/audit-log', async (req, res) => {
    const { page, pageSize } = parse(pageSchema, req.query)
    const [items, total] = await Promise.all([
      db.auditLog.findMany({
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.auditLog.count(),
    ])
    res.json({ items, total, page, pageSize })
  })

  router.get('/audit-log/verify', async (req, res) => {
    const result = await verifyChain(db)
    await appendAudit(db, {
      actorType: 'ADMIN',
      actorId: authOf(req).sub,
      action: 'AUDIT_CHAIN_VERIFIED',
      payload: { ...result },
    })
    res.json(result)
  })

  // UC-14: manage system settings
  router.get('/settings', async (_req, res) => {
    res.json(await getSettings(db))
  })

  router.put('/settings', async (req, res) => {
    const input = parse(settingsUpdateSchema, req.body)
    const updates: Record<string, number> = {}
    for (const [key, raw] of Object.entries(input)) {
      if (!isSettingKey(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Unknown setting: ${key}`)
      const parsed = SETTINGS[key].schema.safeParse(raw)
      if (!parsed.success) {
        throw new ApiError(400, 'VALIDATION_ERROR', `${key}: ${parsed.error.issues[0]?.message}`)
      }
      updates[key] = parsed.data
    }
    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'No settings provided')
    }

    const before = await getSettings(db)
    await db.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(updates)) {
        await tx.systemSetting.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        })
      }
      await appendAudit(tx, {
        actorType: 'ADMIN',
        actorId: authOf(req).sub,
        action: 'SETTINGS_UPDATED',
        payload: Object.fromEntries(
          Object.entries(updates).map(([k, v]) => [
            k,
            { from: before[k as keyof typeof before], to: v },
          ]),
        ),
      })
    })
    res.json(await getSettings(db))
  })

  return router
}
