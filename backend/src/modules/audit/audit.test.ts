import request from 'supertest'
import { beforeEach, describe, expect, test } from 'vitest'
import { createAdmin, db, loginAdmin, resetDb, testApp } from '../../test/helpers.js'
import { appendAudit, verifyChain } from './audit.service.js'

beforeEach(resetDb)

const append = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    appendAudit(db, {
      actorType: 'SYSTEM',
      action: 'TEST',
      payload: { i, nested: { b: 2, a: 1 } },
    }),
  )

describe('hash chain', () => {
  test('an empty chain is valid', async () => {
    expect(await verifyChain(db)).toEqual({ valid: true, checked: 0 })
  })

  test('sequential appends link each row to the previous one', async () => {
    for (const p of append(5)) await p
    const rows = await db.auditLog.findMany({ orderBy: { id: 'asc' } })
    rows.slice(1).forEach((row, i) => expect(row.prevHash).toBe(rows[i]!.hash))
    expect(await verifyChain(db, 2)).toEqual({ valid: true, checked: 5 })
  })

  test('concurrent appends never fork the chain', async () => {
    await Promise.all(append(25))
    expect(await verifyChain(db)).toEqual({ valid: true, checked: 25 })
  })

  test('an audit entry written inside a rolled-back transaction disappears with it', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await appendAudit(tx, { actorType: 'SYSTEM', action: 'WILL_ROLL_BACK' })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await db.auditLog.count()).toBe(0)
    expect(await verifyChain(db)).toEqual({ valid: true, checked: 0 })
  })

  test('editing a row is detected at that row', async () => {
    for (const p of append(3)) await p
    const [, second] = await db.auditLog.findMany({ orderBy: { id: 'asc' } })
    await db.auditLog.update({ where: { id: second!.id }, data: { payload: { i: 999 } } })
    expect(await verifyChain(db)).toMatchObject({
      valid: false,
      brokenAtId: second!.id,
      reason: 'HASH_MISMATCH',
    })
  })

  test('deleting a middle row is detected at the next row', async () => {
    for (const p of append(3)) await p
    const [, second, third] = await db.auditLog.findMany({ orderBy: { id: 'asc' } })
    await db.auditLog.delete({ where: { id: second!.id } })
    expect(await verifyChain(db)).toMatchObject({
      valid: false,
      brokenAtId: third!.id,
      reason: 'PREV_HASH_MISMATCH',
    })
  })

  test('deleting the newest row is detected via the chain head', async () => {
    for (const p of append(3)) await p
    const last = await db.auditLog.findFirst({ orderBy: { id: 'desc' } })
    await db.auditLog.delete({ where: { id: last!.id } })
    expect(await verifyChain(db)).toMatchObject({ valid: false, reason: 'HEAD_MISMATCH' })
  })
})

describe('admin audit-log endpoints', () => {
  test('lists newest first with paging, and verify reports the chain state', async () => {
    await createAdmin()
    const t = testApp()
    const { accessToken } = await loginAdmin(t)
    const auth = { Authorization: `Bearer ${accessToken}` }

    const page = await request(t.app).get('/api/admin/audit-log?pageSize=1').set(auth)
    expect(page.status).toBe(200)
    expect(page.body.items).toHaveLength(1)
    expect(page.body.items[0].action).toBe('ADMIN_LOGIN_SUCCESS')
    expect(page.body.total).toBe(2) // OTP_SENT + LOGIN_SUCCESS

    const verify = await request(t.app).get('/api/admin/audit-log/verify').set(auth)
    expect(verify.body).toEqual({ valid: true, checked: 2 })
  })

  test('rejects an invalid page size', async () => {
    await createAdmin()
    const t = testApp()
    const { accessToken } = await loginAdmin(t)
    const res = await request(t.app)
      .get('/api/admin/audit-log?pageSize=1000')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(res.status).toBe(400)
  })
})
