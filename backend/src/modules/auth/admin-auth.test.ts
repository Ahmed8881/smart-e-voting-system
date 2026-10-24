import request from 'supertest'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  ADMIN,
  createAdmin,
  db,
  loginAdmin,
  refreshCookie,
  resetDb,
  testApp,
  testConfig,
} from '../../test/helpers.js'
import { signAccessToken } from './tokens.js'

let t: ReturnType<typeof testApp>

beforeEach(async () => {
  await resetDb()
  await createAdmin()
  t = testApp()
})

const login = (body: object) => request(t.app).post('/api/auth/admin/login').send(body)
const otp = (body: object) => request(t.app).post('/api/auth/admin/otp').send(body)

describe('admin login step 1 (password)', () => {
  test('correct password emails a 6-digit code and returns a challenge, not a session', async () => {
    const res = await login({ email: ADMIN.email, password: ADMIN.password })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ otpRequired: true, challengeId: expect.any(String) })
    expect(res.body.accessToken).toBeUndefined()
    expect(refreshCookie(res)).toBe('')
    expect(t.mail.sent[0]?.to).toBe(ADMIN.email)
    expect(t.mail.lastOtp()).toMatch(/^\d{6}$/)
  })

  test('email is case-insensitive', async () => {
    const res = await login({ email: ADMIN.email.toUpperCase(), password: ADMIN.password })
    expect(res.status).toBe(200)
  })

  test.each([
    ['wrong password', { email: ADMIN.email, password: 'wrong password!' }],
    ['unknown email', { email: 'nobody@test.local', password: ADMIN.password }],
  ])('%s → 401 with the same message, audited', async (_label, body) => {
    const res = await login(body)
    expect(res.status).toBe(401)
    expect(res.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    })
    expect(t.mail.sent).toHaveLength(0)
    expect(await db.auditLog.count({ where: { action: 'ADMIN_LOGIN_FAILED' } })).toBe(1)
  })

  test('invalid input → 400 VALIDATION_ERROR', async () => {
    const res = await login({ email: 'not-an-email', password: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('admin login step 2 (OTP)', () => {
  async function challenge() {
    const res = await login({ email: ADMIN.email, password: ADMIN.password })
    return { challengeId: res.body.challengeId as string, code: t.mail.lastOtp() }
  }

  test('correct code issues an access token and an httpOnly, Secure, SameSite=Strict refresh cookie', async () => {
    const res = await otp(await challenge())
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toEqual(expect.any(String))
    expect(res.body.admin.email).toBe(ADMIN.email)
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';')
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
    expect(await db.auditLog.count({ where: { action: 'ADMIN_LOGIN_SUCCESS' } })).toBe(1)
  })

  test('a code can be used only once', async () => {
    const c = await challenge()
    expect((await otp(c)).status).toBe(200)
    const again = await otp(c)
    expect(again.status).toBe(401)
    expect(again.body.error.code).toBe('OTP_INVALID')
  })

  test('wrong code → 401; after 5 wrong attempts even the right code is refused', async () => {
    const c = await challenge()
    const wrong = c.code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) expect((await otp({ ...c, code: wrong })).status).toBe(401)
    expect((await otp(c)).status).toBe(401)
    expect(await db.auditLog.count({ where: { action: 'ADMIN_OTP_FAILED' } })).toBe(5)
  })

  test('expired code is refused', async () => {
    const c = await challenge()
    await db.adminOtp.update({
      where: { id: c.challengeId },
      data: { expiresAt: new Date(Date.now() - 1) },
    })
    expect((await otp(c)).status).toBe(401)
  })
})

describe('sessions', () => {
  test('refresh rotates the token; replaying the old one revokes every session', async () => {
    const { cookie } = await loginAdmin(t)
    const first = await request(t.app).post('/api/auth/refresh').set('Cookie', cookie)
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ accessToken: expect.any(String), role: 'ADMIN' })
    const rotated = refreshCookie(first)
    expect(rotated).not.toBe(cookie)

    const replay = await request(t.app).post('/api/auth/refresh').set('Cookie', cookie)
    expect(replay.status).toBe(401)
    // The legitimately rotated token is revoked too, and presenting it is flagged as reuse as well.
    expect((await request(t.app).post('/api/auth/refresh').set('Cookie', rotated)).status).toBe(401)
    expect(await db.auditLog.count({ where: { action: 'REFRESH_TOKEN_REUSE_DETECTED' } })).toBe(2)
  })

  test('refresh without a cookie → 401', async () => {
    const res = await request(t.app).post('/api/auth/refresh')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('logout revokes the refresh token', async () => {
    const { cookie } = await loginAdmin(t)
    expect((await request(t.app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(204)
    expect((await request(t.app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401)
  })
})

describe('RBAC on /api/admin', () => {
  test('no token → 401', async () => {
    expect((await request(t.app).get('/api/admin/me')).status).toBe(401)
  })

  test('garbage token → 401', async () => {
    const res = await request(t.app).get('/api/admin/me').set('Authorization', 'Bearer nope')
    expect(res.status).toBe(401)
  })

  test('voter token → 403', async () => {
    const voterToken = signAccessToken(testConfig, { sub: 'some-voter', role: 'VOTER' })
    const res = await request(t.app)
      .get('/api/admin/me')
      .set('Authorization', `Bearer ${voterToken}`)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  test('admin token → 200 with profile, no password hash', async () => {
    const { accessToken } = await loginAdmin(t)
    const res = await request(t.app)
      .get('/api/admin/me')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: expect.any(String), name: ADMIN.name, email: ADMIN.email })
  })
})

test('login endpoints are rate limited per IP', async () => {
  const statuses: number[] = []
  for (let i = 0; i < 21; i++) {
    statuses.push((await login({ email: 'x@test.local', password: 'wrong' })).status)
  }
  expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true)
  expect(statuses[20]).toBe(429)
}, 60_000)
