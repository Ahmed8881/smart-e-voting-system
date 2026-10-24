import request from 'supertest'
import { beforeEach, describe, expect, test } from 'vitest'
import type { VoterStatus } from '../../generated/prisma/client.js'
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
import { SoftAuthenticator } from '../../test/softAuthenticator.js'
import { verifyChain } from '../audit/audit.service.js'

let t: ReturnType<typeof testApp>
const FRAMES = Array(8).fill('ZmFrZQ==')
const CNIC = '35202-1234567-1'

beforeEach(async () => {
  await resetDb()
  t = testApp()
})

/** An enrolled voter whose face is "person 1". */
async function voter(status: VoterStatus = 'APPROVED', cnic = CNIC) {
  const v = await db.voter.create({
    data: { name: 'Aisha', email: `${cnic}@test.local`, cnic, status },
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
      modelVersion: 'sface_2021dec',
    },
  })
  return v
}

async function faceStep(cnic = CNIC) {
  const challenge = await request(t.app).post('/api/auth/voter/challenge')
  return request(t.app)
    .post('/api/auth/voter/face')
    .send({ cnic, challengeToken: challenge.body.challengeToken, frames: FRAMES })
}

async function enrol(device: SoftAuthenticator) {
  const face = await faceStep()
  expect(face.body.next).toBe('WEBAUTHN_ENROL')
  const options = await request(t.app)
    .post('/api/voters/me/webauthn/register/options')
    .send({ faceToken: face.body.faceToken })
  expect(options.status).toBe(200)
  return request(t.app)
    .post('/api/voters/me/webauthn/register/verify')
    .send({ faceToken: face.body.faceToken, response: device.register(options.body) })
}

async function login(
  device: SoftAuthenticator,
  assertion: Parameters<SoftAuthenticator['authenticate']>[1] = {},
) {
  const face = await faceStep()
  expect(face.body.next).toBe('WEBAUTHN_LOGIN')
  const options = await request(t.app)
    .post('/api/auth/voter/webauthn/options')
    .send({ faceToken: face.body.faceToken })
  expect(options.status).toBe(200)
  const response = device.authenticate(options.body, assertion)
  const res = await request(t.app)
    .post('/api/auth/voter/webauthn/verify')
    .send({ faceToken: face.body.faceToken, response })
  return Object.assign(res, { faceToken: face.body.faceToken as string, response })
}

describe('step 1: face', () => {
  test('unknown CNIC → 401 without revealing that it is unknown', async () => {
    const res = await faceStep('99999-9999999-9')
    expect(res.status).toBe(401)
    expect(res.body.error).toEqual({
      code: 'FACE_NOT_VERIFIED',
      message: 'Face verification failed',
    })
    expect(await db.authEvent.count({ where: { type: 'FACE', success: false } })).toBe(1)
  })

  test.each([
    ['PENDING', /waiting for administrator approval/],
    ['SUSPENDED', /suspended/],
    ['LOCKED', /locked/],
  ] as const)('%s voter → 403 with an explanation', async (status, message) => {
    await voter(status)
    const res = await faceStep()
    expect(res.status).toBe(403)
    expect(res.body.error.message).toMatch(message)
  })

  test('someone else’s face → 401', async () => {
    await voter()
    t.ai.person = 2
    expect((await faceStep()).body.error.code).toBe('FACE_NOT_VERIFIED')
  })

  test('failed liveness → 422, recorded as a LIVENESS event', async () => {
    await voter()
    t.ai.live = false
    expect((await faceStep()).status).toBe(422)
    expect(await db.authEvent.count({ where: { type: 'LIVENESS', success: false } })).toBe(1)
  })

  test('a voter with no device is sent to enrolment', async () => {
    await voter()
    const res = await faceStep()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      faceToken: expect.any(String),
      next: 'WEBAUTHN_ENROL',
      recoveryPending: false,
    })
  })
})

describe('device enrolment and login', () => {
  test('first device enrols with user verification and signs the voter in', async () => {
    const v = await voter()
    const device = new SoftAuthenticator()
    const res = await enrol(device)
    expect(res.status).toBe(201)
    expect(res.body.voter).toEqual({ id: v.id, name: 'Aisha' })

    const stored = await db.webAuthnCredential.findFirstOrThrow({ where: { voterId: v.id } })
    expect(stored.credentialId).toBe(device.id)
    expect(stored.transports).toEqual(['internal'])

    const me = await request(t.app)
      .get('/api/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
    expect(me.body).toMatchObject({ id: v.id, status: 'APPROVED' })
  })

  test('returning voter: face then fingerprint → session, counter stored, audited', async () => {
    const v = await voter()
    const device = new SoftAuthenticator()
    await enrol(device)
    const res = await login(device)
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toEqual(expect.any(String))
    expect(
      (await db.webAuthnCredential.findFirstOrThrow({ where: { voterId: v.id } })).signCount,
    ).toBe(1)
    expect(await db.auditLog.count({ where: { action: 'VOTER_LOGIN' } })).toBe(1)
    expect((await verifyChain(db)).valid).toBe(true)
  })

  test('a replayed assertion is refused (challenge already used)', async () => {
    await voter()
    const device = new SoftAuthenticator()
    await enrol(device)
    const first = await login(device)
    const replay = await request(t.app)
      .post('/api/auth/voter/webauthn/verify')
      .send({ faceToken: first.faceToken, response: first.response })
    expect(replay.status).toBe(400)
    expect(replay.body.error.code).toBe('WEBAUTHN_CHALLENGE_INVALID')
  })

  test('a cloned credential (counter did not increase) is refused and raises a HIGH alert', async () => {
    const v = await voter()
    const device = new SoftAuthenticator()
    await enrol(device)
    await login(device) // counter 1
    const res = await login(device, { cloned: true }) // still 1
    expect(res.status).toBe(401)
    expect(await db.fraudAlert.findFirstOrThrow()).toMatchObject({
      type: 'WEBAUTHN_COUNTER_REGRESSION',
      severity: 'HIGH',
      voterId: v.id,
    })
  })

  test('device unlocked without fingerprint/PIN (no user verification) is refused', async () => {
    await voter()
    const device = new SoftAuthenticator()
    await enrol(device)
    expect((await login(device, { userVerified: false })).status).toBe(401)
  })

  test('an assertion made for another website is refused', async () => {
    await voter()
    const device = new SoftAuthenticator()
    await enrol(device)
    expect((await login(device, { origin: 'https://phishing.example' })).status).toBe(401)
  })

  test('another device (not registered to this voter) is refused', async () => {
    await voter()
    await enrol(new SoftAuthenticator())
    expect((await login(new SoftAuthenticator())).status).toBe(401)
  })

  test('a voter suspended between the two steps cannot finish logging in', async () => {
    const v = await voter()
    const device = new SoftAuthenticator()
    await enrol(device)
    const face = await faceStep()
    await db.voter.update({ where: { id: v.id }, data: { status: 'SUSPENDED' } })
    const res = await request(t.app)
      .post('/api/auth/voter/webauthn/options')
      .send({ faceToken: face.body.faceToken })
    expect(res.status).toBe(200) // options are harmless…
    const verify = await request(t.app)
      .post('/api/auth/voter/webauthn/verify')
      .send({ faceToken: face.body.faceToken, response: device.authenticate(res.body) })
    expect(verify.status).toBe(403) // …but the login is not completed
  })

  test('a second device cannot be enrolled while one is active', async () => {
    await voter()
    const face = await faceStep()
    const options = await request(t.app)
      .post('/api/voters/me/webauthn/register/options')
      .send({ faceToken: face.body.faceToken })
    await request(t.app)
      .post('/api/voters/me/webauthn/register/verify')
      .send({
        faceToken: face.body.faceToken,
        response: new SoftAuthenticator().register(options.body),
      })
    const again = await request(t.app)
      .post('/api/voters/me/webauthn/register/options')
      .send({ faceToken: face.body.faceToken })
    expect(again.status).toBe(409)
  })
})

describe('session after the account changes', () => {
  test.each(['SUSPENDED', 'LOCKED'] as const)(
    'a %s voter cannot refresh their session, and all their sessions are revoked',
    async (status) => {
      const v = await voter()
      const res = await enrol(new SoftAuthenticator())
      const cookie = ([] as string[])
        .concat(res.headers['set-cookie'] ?? [])
        .find((c) => c.startsWith('rt='))!
        .split(';')[0]!
      await db.voter.update({ where: { id: v.id }, data: { status } })
      const refresh = await request(t.app).post('/api/auth/refresh').set('Cookie', cookie)
      expect(refresh.status).toBe(401)
      expect(await db.refreshToken.count({ where: { subjectId: v.id, revokedAt: null } })).toBe(0)
    },
  )
})

describe('step tokens', () => {
  test('a face-step token is not an access token, and vice versa', async () => {
    await voter()
    const face = await faceStep()
    const asAccess = await request(t.app)
      .get('/api/me')
      .set('Authorization', `Bearer ${face.body.faceToken}`)
    expect(asAccess.status).toBe(401)

    const { body } = await enrol(new SoftAuthenticator())
    const asFace = await request(t.app)
      .post('/api/auth/voter/webauthn/options')
      .send({ faceToken: body.accessToken })
    expect(asFace.body.error.code).toBe('FACE_STEP_REQUIRED')
  })

  test('an enrolment token cannot start a login', async () => {
    await voter()
    const face = await faceStep()
    const res = await request(t.app)
      .post('/api/auth/voter/webauthn/options')
      .send({ faceToken: face.body.faceToken })
    expect(res.status).toBe(401)
  })
})

describe('lost-device recovery', () => {
  async function adminAuth() {
    await createAdmin()
    return { Authorization: `Bearer ${(await loginAdmin(t)).accessToken}` }
  }

  test('request → admin approves → old device revoked → new device enrols', async () => {
    const v = await voter()
    const oldDevice = new SoftAuthenticator()
    await enrol(oldDevice)

    const face = await faceStep()
    const requested = await request(t.app)
      .post('/api/auth/voter/recovery')
      .send({ faceToken: face.body.faceToken })
    expect(requested.status).toBe(202)
    expect((await faceStep()).body.recoveryPending).toBe(true)

    const auth = await adminAuth()
    const list = await request(t.app).get('/api/admin/recovery-requests').set(auth)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].voter).toMatchObject({ id: v.id, cnic: CNIC })
    const approved = await request(t.app)
      .post(`/api/admin/recovery-requests/${list.body[0].id}/approve`)
      .set(auth)
    expect(approved.body).toMatchObject({ status: 'APPROVED', credentialsRevoked: 1 })

    const newDevice = new SoftAuthenticator()
    expect((await enrol(newDevice)).status).toBe(201)
    expect((await login(newDevice)).status).toBe(200)
    expect(
      await db.webAuthnCredential.count({ where: { voterId: v.id, revokedAt: { not: null } } }),
    ).toBe(1)
    expect(await db.auditLog.count({ where: { action: 'RECOVERY_APPROVED' } })).toBe(1)
  })

  test('requesting twice keeps a single pending request', async () => {
    await voter()
    await enrol(new SoftAuthenticator())
    const face = await faceStep()
    await request(t.app).post('/api/auth/voter/recovery').send({ faceToken: face.body.faceToken })
    await request(t.app).post('/api/auth/voter/recovery').send({ faceToken: face.body.faceToken })
    expect(await db.recoveryRequest.count()).toBe(1)
  })

  test('reject keeps the old device; a request cannot be decided twice', async () => {
    await voter()
    const device = new SoftAuthenticator()
    await enrol(device)
    const face = await faceStep()
    await request(t.app).post('/api/auth/voter/recovery').send({ faceToken: face.body.faceToken })
    const auth = await adminAuth()
    const [pending] = (await request(t.app).get('/api/admin/recovery-requests').set(auth)).body
    expect(
      (await request(t.app).post(`/api/admin/recovery-requests/${pending.id}/reject`).set(auth))
        .status,
    ).toBe(200)
    expect(
      (await request(t.app).post(`/api/admin/recovery-requests/${pending.id}/approve`).set(auth))
        .status,
    ).toBe(409)
    expect((await login(device)).status).toBe(200)
  })
})
