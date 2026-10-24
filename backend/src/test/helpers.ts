import bcrypt from 'bcrypt'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { type Db, createDb } from '../db.js'
import type { AiClient, EnrolResult } from '../lib/aiClient.js'
import type { Mail, Mailer } from '../lib/mailer.js'
import { GENESIS_HASH } from '../modules/audit/audit.service.js'

export const testConfig = loadConfig({
  ...process.env,
  JWT_ACCESS_SECRET: 'test-secret-'.padEnd(48, 'x'),
  CORS_ORIGIN: 'http://localhost:5173',
  SMTP_URL: '',
  AI_SERVICE_TOKEN: 'test-service-token-'.padEnd(40, 'x'),
  FACE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
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

/** A distinct "person": one-hot embeddings, so same person = similarity 1, different = 0. */
export function personEmbedding(person: number): string {
  const v = new Float32Array(128)
  v[person % 128] = 1
  return Buffer.from(v.buffer).toString('base64')
}

/**
 * Stands in for the AI service. Tests set who is in front of the camera (`person`) and whether
 * the liveness check passes; challenge tokens encode their nonce like the real service's do.
 */
export class FakeAi implements AiClient {
  person = 1
  live = true
  reason: string | null = null
  calls = 0

  async challenge() {
    const nonce = randomUUID()
    return {
      token: `tok.${nonce}`,
      nonce,
      actions: ['BLINK' as const, 'TURN_LEFT' as const],
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    }
  }

  async enrol(token: string, frames: string[]): Promise<EnrolResult> {
    this.calls++
    return {
      nonce: token.split('.')[1] ?? '',
      live: this.live,
      reason: this.live ? null : (this.reason ?? 'ACTION_NOT_DETECTED:BLINK'),
      modelVersion: 'sface_2021dec',
      frameCount: frames.length,
      embedding: this.live ? personEmbedding(this.person) : null,
    }
  }

  async verify(token: string, frames: string[], reference: string) {
    const { embedding, ...rest } = await this.enrol(token, frames)
    return { ...rest, similarity: embedding === null ? null : embedding === reference ? 1 : 0 }
  }
}

export function testApp() {
  const mail = fakeMailer()
  const ai = new FakeAi()
  return { app: createApp({ config: testConfig, db, mailer: mail.mailer, ai }), mail, ai }
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
    db.livenessChallenge.deleteMany(),
    db.webAuthnChallenge.deleteMany(),
    db.recoveryRequest.deleteMany(),
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
