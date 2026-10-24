import request from 'supertest'
import { beforeEach, describe, expect, test } from 'vitest'
import { embeddingFromBase64 } from '../../lib/embedding.js'
import { encryptEmbedding } from '../../lib/faceCrypto.js'
import {
  createAdmin,
  db,
  loginAdmin,
  personEmbedding,
  resetDb,
  testApp,
  testConfig,
} from '../../test/helpers.js'
import { recordAuthEvent, raiseAlert } from './fraud.service.js'

let t: ReturnType<typeof testApp>
const deps = () => ({ db }) as never
const CNIC = '35202-1234567-1'

beforeEach(async () => {
  await resetDb()
  t = testApp()
})

async function enrolledVoter(cnic = CNIC) {
  const v = await db.voter.create({
    data: { name: 'Aisha', email: `${cnic}@t.local`, cnic, status: 'APPROVED' },
  })
  const enc = encryptEmbedding(
    testConfig.FACE_ENCRYPTION_KEY,
    v.id,
    embeddingFromBase64(personEmbedding(1)),
  )
  await db.faceTemplate.create({
    data: {
      voterId: v.id,
      embeddingCiphertext: Uint8Array.from(enc.ciphertext),
      iv: Uint8Array.from(enc.iv),
      authTag: Uint8Array.from(enc.authTag),
      modelVersion: 'x',
    },
  })
  return v
}

/** One face-step attempt through the real endpoint. */
async function faceAttempt(cnic = CNIC, headers: Record<string, string> = {}) {
  const challenge = await request(t.app).post('/api/auth/voter/challenge')
  return request(t.app)
    .post('/api/auth/voter/face')
    .set(headers)
    .send({ cnic, challengeToken: challenge.body.challengeToken, frames: Array(8).fill('eA==') })
}

const event = (over: object = {}) => ({
  type: 'FACE' as const,
  success: false,
  ip: '10.0.0.1',
  userAgent: 'test',
  deviceHash: 'd'.repeat(64),
  cnicAttempted: CNIC,
  ...over,
})

describe('rule: repeated failed logins', () => {
  test('the Nth failure raises one HIGH alert and locks the account', async () => {
    const v = await enrolledVoter()
    t.ai.person = 2 // wrong face every time
    for (let i = 0; i < 4; i++) await faceAttempt()
    expect(await db.fraudAlert.count()).toBe(0)
    await faceAttempt() // 5th = default fraud.maxFailedLogins
    const alert = await db.fraudAlert.findFirstOrThrow()
    expect(alert).toMatchObject({ type: 'REPEATED_FAILED_LOGINS', severity: 'HIGH', voterId: v.id })
    expect((await db.voter.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('LOCKED')
    expect(await db.auditLog.count({ where: { action: 'VOTER_LOCKED' } })).toBe(1)

    // Locked: even the right face is now refused, and no duplicate alert piles up.
    t.ai.person = 1
    expect((await faceAttempt()).status).toBe(403)
    expect(await db.fraudAlert.count({ where: { type: 'REPEATED_FAILED_LOGINS' } })).toBe(1)
  })

  test('failures against an unknown CNIC are still caught (no voter to lock)', async () => {
    for (let i = 0; i < 5; i++)
      await recordAuthEvent(deps(), event({ cnicAttempted: '99999-9999999-9' }))
    expect(await db.fraudAlert.findFirstOrThrow()).toMatchObject({
      voterId: null,
      severity: 'HIGH',
    })
  })

  test('the threshold comes from settings', async () => {
    await db.systemSetting.create({ data: { key: 'fraud.maxFailedLogins', value: '2' } })
    for (let i = 0; i < 2; i++) await recordAuthEvent(deps(), event())
    expect(await db.fraudAlert.count()).toBe(1)
  })

  test('failures outside the window do not count', async () => {
    await db.authEvent.createMany({
      data: Array.from({ length: 4 }, () => ({
        ...event(),
        createdAt: new Date(Date.now() - 3_600_000),
      })),
    })
    await recordAuthEvent(deps(), event())
    expect(await db.fraudAlert.count()).toBe(0)
  })
})

test('rule: repeated liveness failures → MEDIUM, no lock', async () => {
  const v = await enrolledVoter()
  t.ai.live = false
  for (let i = 0; i < 3; i++) await faceAttempt()
  expect(
    await db.fraudAlert.findFirstOrThrow({ where: { type: 'REPEATED_LIVENESS_FAILURE' } }),
  ).toMatchObject({
    severity: 'MEDIUM',
    voterId: v.id,
  })
  expect((await db.voter.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('APPROVED')
})

test('rule: one device trying K different CNICs → MEDIUM SHARED_DEVICE (and LOW SHARED_IP)', async () => {
  for (const cnic of ['11111-1111111-1', '22222-2222222-2', '33333-3333333-3']) {
    await recordAuthEvent(deps(), event({ cnicAttempted: cnic, success: true }))
  }
  const alerts = await db.fraudAlert.findMany({ orderBy: { type: 'asc' } })
  expect(alerts.map((a) => [a.type, a.severity])).toEqual([
    ['SHARED_DEVICE', 'MEDIUM'],
    ['SHARED_IP', 'LOW'],
  ])
  // A 4th account doesn't add another alert while the first is open.
  await recordAuthEvent(deps(), event({ cnicAttempted: '44444-4444444-4', success: true }))
  expect(await db.fraudAlert.count()).toBe(2)
})

test('a HIGH alert does not lock an already SUSPENDED voter (status kept)', async () => {
  const v = await db.voter.create({
    data: { name: 'S', email: 's@t.local', cnic: '12345-1234567-1', status: 'SUSPENDED' },
  })
  await raiseAlert(db, {
    type: 'X',
    severity: 'HIGH',
    voterId: v.id,
    description: 'x',
    details: {},
  })
  expect((await db.voter.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('SUSPENDED')
})

describe('anomaly model', () => {
  test('a high score raises a MEDIUM alert but the login still succeeds', async () => {
    const v = await enrolledVoter()
    t.ai.anomalyScore = 0.93
    const res = await faceAttempt()
    expect(res.status).toBe(200)
    expect(await db.fraudAlert.findFirstOrThrow()).toMatchObject({
      type: 'ANOMALOUS_LOGIN',
      severity: 'MEDIUM',
      voterId: v.id,
      score: 0.93,
    })
    expect((await db.voter.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('APPROVED')
  })

  test('features describe the login', async () => {
    await enrolledVoter()
    await faceAttempt()
    expect(t.ai.scoreCalls[0]).toMatchObject({
      failed_attempts_last_hour: 0,
      new_device: true,
      new_ip: true,
      accounts_on_device_24h: 1,
      days_since_registration: 0,
      face_similarity: 1,
    })
  })

  test('below the threshold → no alert', async () => {
    await enrolledVoter()
    t.ai.anomalyScore = 0.4
    await faceAttempt()
    expect(await db.fraudAlert.count()).toBe(0)
  })

  test('model unavailable → login unaffected', async () => {
    await enrolledVoter()
    t.ai.score = async () => {
      throw new Error('model not trained')
    }
    expect((await faceAttempt()).status).toBe(200)
  })
})

describe('admin fraud alerts API', () => {
  async function adminAuth() {
    await createAdmin()
    return { Authorization: `Bearer ${(await loginAdmin(t)).accessToken}` }
  }

  test('lists alerts with voter details and open counts; filters by status/severity', async () => {
    const v = await enrolledVoter()
    await raiseAlert(db, {
      type: 'A',
      severity: 'MEDIUM',
      voterId: v.id,
      description: 'a',
      details: {},
    })
    await raiseAlert(db, { type: 'B', severity: 'LOW', description: 'b', details: {} })
    const auth = await adminAuth()
    const all = await request(t.app).get('/api/admin/fraud-alerts').set(auth)
    expect(all.body.total).toBe(2)
    expect(all.body.openBySeverity).toEqual({ MEDIUM: 1, LOW: 1 })
    expect(all.body.items.find((a: { type: string }) => a.type === 'A').voter).toMatchObject({
      cnic: CNIC,
    })
    const low = await request(t.app).get('/api/admin/fraud-alerts?severity=LOW').set(auth)
    expect(low.body.items.map((a: { type: string }) => a.type)).toEqual(['B'])
  })

  test('review once, audited; a second decision is refused', async () => {
    const alert = await raiseAlert(db, {
      type: 'A',
      severity: 'LOW',
      description: 'a',
      details: {},
    })
    const auth = await adminAuth()
    const res = await request(t.app)
      .patch(`/api/admin/fraud-alerts/${alert.id}`)
      .set(auth)
      .send({ status: 'DISMISSED' })
    expect(res.body).toMatchObject({ status: 'DISMISSED', reviewedById: expect.any(String) })
    expect(await db.auditLog.count({ where: { action: 'FRAUD_ALERT_REVIEWED' } })).toBe(1)
    const again = await request(t.app)
      .patch(`/api/admin/fraud-alerts/${alert.id}`)
      .set(auth)
      .send({ status: 'REVIEWED' })
    expect(again.status).toBe(409)
  })

  test('cannot set an alert back to OPEN', async () => {
    const alert = await raiseAlert(db, {
      type: 'A',
      severity: 'LOW',
      description: 'a',
      details: {},
    })
    const res = await request(t.app)
      .patch(`/api/admin/fraud-alerts/${alert.id}`)
      .set(await adminAuth())
      .send({ status: 'OPEN' })
    expect(res.status).toBe(400)
  })

  test('requires an admin', async () => {
    expect((await request(t.app).get('/api/admin/fraud-alerts')).status).toBe(401)
  })
})
