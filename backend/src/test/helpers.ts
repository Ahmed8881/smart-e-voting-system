import bcrypt from 'bcrypt'
import request from 'supertest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { type Db, createDb } from '../db.js'
import type { Mail, Mailer } from '../lib/mailer.js'
import { GENESIS_HASH } from '../modules/audit/audit.service.js'

export const testConfig = loadConfig({
  ...process.env,
  JWT_ACCESS_SECRET: 'test-secret-'.padEnd(48, 'x'),
  CORS_ORIGIN: 'http://localhost:5173',
  SMTP_URL: '',
})

export const db: Db = createDb(testConfig.DATABASE_URL)

/** Captures outgoing mail instead of sending it. */
export function fakeMailer() {
  const sent: Mail[] = []
  const mailer: Mailer = {
    async send(mail) {
      sent.push(mail)
    },
  }
  return { mailer, sent, lastOtp: () => sent.at(-1)?.text.match(/\b(\d{6})\b/)?.[1] ?? '' }
}

export function testApp() {
  const mail = fakeMailer()
  return { app: createApp({ config: testConfig, db, mailer: mail.mailer }), mail }
}

/** Empties every table (children first) and restores the audit chain genesis. */
export async function resetDb() {
  await db.$transaction([
    db.resultTally.deleteMany(),
    db.ballot.deleteMany(),
    db.participation.deleteMany(),
    db.candidate.deleteMany(),
    db.fraudAlert.deleteMany(),
    db.election.deleteMany(),
    db.authEvent.deleteMany(),
    db.webAuthnCredential.deleteMany(),
    db.faceTemplate.deleteMany(),
    db.voter.deleteMany(),
    db.adminOtp.deleteMany(),
    db.refreshToken.deleteMany(),
    db.admin.deleteMany(),
    db.auditLog.deleteMany(),
    db.systemSetting.deleteMany(),
    db.auditChainHead.update({ where: { id: 1 }, data: { lastHash: GENESIS_HASH } }),
  ])
}

export const ADMIN = {
  name: 'Test Admin',
  email: 'admin@test.local',
  password: 'correct horse battery',
}

export async function createAdmin() {
  // Low cost keeps tests fast; production cost (12) is covered by the seed script.
  return db.admin.create({
    data: {
      name: ADMIN.name,
      email: ADMIN.email,
      passwordHash: await bcrypt.hash(ADMIN.password, 4),
    },
  })
}

/** Full two-step admin login. Returns the access token and the refresh cookie. */
export async function loginAdmin(app: ReturnType<typeof testApp>) {
  const step1 = await request(app.app)
    .post('/api/auth/admin/login')
    .send({ email: ADMIN.email, password: ADMIN.password })
  const step2 = await request(app.app)
    .post('/api/auth/admin/otp')
    .send({ challengeId: step1.body.challengeId, code: app.mail.lastOtp() })
  return { accessToken: step2.body.accessToken as string, cookie: refreshCookie(step2) }
}

export function refreshCookie(res: request.Response) {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? [])
  return raw.find((c) => c.startsWith('rt='))?.split(';')[0] ?? ''
}
