import request from 'supertest'
import { beforeEach, expect, test } from 'vitest'
import { createAdmin, db, loginAdmin, resetDb, testApp } from '../../test/helpers.js'
import { verifyChain } from '../audit/audit.service.js'

let t: ReturnType<typeof testApp>
let auth: { Authorization: string }

beforeEach(async () => {
  await resetDb()
  await createAdmin()
  t = testApp()
  auth = { Authorization: `Bearer ${(await loginAdmin(t)).accessToken}` }
})

test('returns defaults when nothing is stored', async () => {
  const res = await request(t.app).get('/api/admin/settings').set(auth)
  expect(res.status).toBe(200)
  expect(res.body['fraud.maxFailedLogins']).toBe(5)
  expect(res.body['face.matchThreshold']).toBe(0.363)
})

test('updates valid settings and records old → new in the audit log', async () => {
  const res = await request(t.app)
    .put('/api/admin/settings')
    .set(auth)
    .send({ 'fraud.maxFailedLogins': 7, 'face.matchThreshold': '0.4' })
  expect(res.status).toBe(200)
  expect(res.body['fraud.maxFailedLogins']).toBe(7)
  expect(res.body['face.matchThreshold']).toBe(0.4)

  const entry = await db.auditLog.findFirst({ where: { action: 'SETTINGS_UPDATED' } })
  expect(entry?.payload).toEqual({
    'fraud.maxFailedLogins': { from: 5, to: 7 },
    'face.matchThreshold': { from: 0.363, to: 0.4 },
  })
  expect((await verifyChain(db)).valid).toBe(true)
})

test.each([
  [{ 'no.such.key': 1 }, /Unknown setting/],
  [{ 'fraud.maxFailedLogins': 0 }, /fraud.maxFailedLogins/],
  [{ 'face.matchThreshold': 2 }, /face.matchThreshold/],
  [{ 'fraud.maxFailedLogins': 'abc' }, /fraud.maxFailedLogins/],
  [{}, /No settings/],
])('rejects %j without changing anything', async (body, message) => {
  const res = await request(t.app).put('/api/admin/settings').set(auth).send(body)
  expect(res.status).toBe(400)
  expect(res.body.error.message).toMatch(message)
  expect(await db.systemSetting.count()).toBe(0)
})
