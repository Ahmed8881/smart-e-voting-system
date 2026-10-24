import request from 'supertest'
import { beforeEach, describe, expect, test } from 'vitest'
import { verifyChain } from '../audit/audit.service.js'
import { db, resetDb, testApp, testConfig } from '../../test/helpers.js'
import { decryptEmbedding } from '../../lib/faceCrypto.js'

let t: ReturnType<typeof testApp>

beforeEach(async () => {
  await resetDb()
  t = testApp()
})

const FRAMES = Array(8).fill('ZmFrZQ==')
let n = 0
const person = () => {
  n++
  return {
    name: `Voter ${n}`,
    email: `voter${n}@test.local`,
    cnic: `35202-${String(1000000 + n)}-1`,
  }
}

async function challenge() {
  const res = await request(t.app).post('/api/voters/register/challenge')
  expect(res.status).toBe(200)
  return res.body.challengeToken as string
}

async function register(details = person(), token?: string) {
  return request(t.app)
    .post('/api/voters/register')
    .send({ ...details, challengeToken: token ?? (await challenge()), frames: FRAMES })
}

describe('POST /api/voters/register', () => {
  test('creates a PENDING voter with an encrypted face template', async () => {
    const details = person()
    const res = await register(details)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: expect.any(String), status: 'PENDING' })

    const template = await db.faceTemplate.findUniqueOrThrow({ where: { voterId: res.body.id } })
    expect(template.modelVersion).toBe('sface_2021dec')
    const plaintext = decryptEmbedding(testConfig.FACE_ENCRYPTION_KEY, res.body.id, {
      ciphertext: Buffer.from(template.embeddingCiphertext),
      iv: Buffer.from(template.iv),
      authTag: Buffer.from(template.authTag),
    })
    expect(plaintext.readFloatLE(4)).toBe(1) // person 1's one-hot vector
    expect(Buffer.from(template.embeddingCiphertext).equals(plaintext)).toBe(false)

    expect(await db.auditLog.count({ where: { action: 'VOTER_REGISTERED' } })).toBe(1)
    expect(await db.authEvent.count({ where: { type: 'REGISTRATION', success: true } })).toBe(1)
    expect((await verifyChain(db)).valid).toBe(true)
  })

  test('sets a device cookie and records a device hash', async () => {
    const res = await register()
    expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';')).toMatch(
      /did=.*HttpOnly/i,
    )
    const event = await db.authEvent.findFirstOrThrow()
    expect(event.deviceHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test.each([
    ['12345-1234567', 'cnic'],
    ['1234512345671', 'cnic'],
    ['abcde-1234567-1', 'cnic'],
  ])('rejects malformed CNIC %s', async (cnic) => {
    const res = await register({ ...person(), cnic })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/cnic/)
    expect(t.ai.calls).toBe(0)
  })

  test('rejects too few frames', async () => {
    const res = await request(t.app)
      .post('/api/voters/register')
      .send({ ...person(), challengeToken: await challenge(), frames: ['a', 'b'] })
    expect(res.status).toBe(400)
  })

  test.each(['email', 'cnic'] as const)(
    'duplicate %s → 409 before any face analysis',
    async (field) => {
      const first = person()
      await register(first)
      t.ai.person = 2
      const calls = t.ai.calls
      const res = await register({ ...person(), [field]: first[field] })
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('ALREADY_REGISTERED')
      expect(t.ai.calls).toBe(calls)
    },
  )

  test('failed liveness → 422, nothing stored, failure recorded', async () => {
    t.ai.live = false
    const res = await register()
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('LIVENESS_FAILED')
    expect(await db.voter.count()).toBe(0)
    expect(await db.authEvent.count({ where: { type: 'LIVENESS', success: false } })).toBe(1)
  })

  test('the same face registering again under new details → 409 + HIGH fraud alert', async () => {
    const first = await register()
    const res = await register() // FakeAi still sees person 1
    expect(res.status).toBe(409)
    expect(res.body.error).toEqual({
      code: 'DUPLICATE_FACE',
      message: 'This person appears to be registered already',
    })
    expect(await db.voter.count()).toBe(1)
    const alert = await db.fraudAlert.findFirstOrThrow()
    expect(alert).toMatchObject({
      type: 'DUPLICATE_FACE_REGISTRATION',
      severity: 'HIGH',
      status: 'OPEN',
      voterId: first.body.id,
    })
  })

  test('a different face registers fine', async () => {
    await register()
    t.ai.person = 2
    expect((await register()).status).toBe(201)
  })

  test('a challenge can be used only once (replayed capture)', async () => {
    const token = await challenge()
    expect((await register(person(), token)).status).toBe(201)
    t.ai.person = 2
    const replay = await register(person(), token)
    expect(replay.status).toBe(400)
    expect(replay.body.error.code).toBe('CHALLENGE_USED')
  })

  test('a challenge not issued through this backend is refused', async () => {
    const res = await register(person(), 'tok.not-issued-by-us')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('CHALLENGE_USED')
    expect(await db.voter.count()).toBe(0)
  })

  test('two simultaneous registrations with the same CNIC create exactly one voter', async () => {
    const details = person()
    const [a, b] = await Promise.all([
      register(details),
      (async () => {
        const token = await challenge()
        t.ai.person = 1
        return request(t.app)
          .post('/api/voters/register')
          .send({ ...details, email: 'other@test.local', challengeToken: token, frames: FRAMES })
      })(),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(await db.voter.count()).toBe(1)
  })

  test('AI service down → 503 in the standard shape', async () => {
    t.ai.enrol = async () => {
      throw Object.assign(
        new (await import('../../errors.js')).ApiError(503, 'AI_UNAVAILABLE', 'x'),
      )
    }
    const res = await register()
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('AI_UNAVAILABLE')
  })

  test('oversized body → 413 in the standard shape', async () => {
    const res = await request(t.app)
      .post('/api/voters/register')
      .send({ ...person(), challengeToken: 'x', frames: ['a'.repeat(4_000_000)] })
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })
})
