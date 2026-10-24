import bcrypt from 'bcrypt'
import { Router } from 'express'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import { safeEqualHex, sha256 } from '../../lib/crypto.js'
import { parse } from '../../lib/validate.js'
import { appendAudit } from '../audit/audit.service.js'
import { issueSession } from './tokens.js'

export const BCRYPT_COST = 12
const OTP_TTL_MS = 5 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', BCRYPT_COST)

const loginSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
})

const otpSchema = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
})

export function adminAuthRouter({ db, config, mailer }: Deps) {
  const router = Router()

  // Step 1: password. On success an OTP is emailed; no session is issued yet.
  router.post('/login', async (req, res) => {
    const { email, password } = parse(loginSchema, req.body)
    const admin = await db.admin.findUnique({ where: { email } })
    const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH)

    if (!admin || !ok) {
      await appendAudit(db, {
        actorType: 'ANONYMOUS',
        action: 'ADMIN_LOGIN_FAILED',
        payload: { email, ip: req.ip },
      })
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const challenge = await db.adminOtp.create({
      data: {
        adminId: admin.id,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    })
    await mailer.send({
      to: admin.email,
      subject: 'Your E-Voting admin login code',
      text: `Your login code is ${code}. It expires in 5 minutes. If you did not try to log in, change your password.`,
    })
    await appendAudit(db, {
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'ADMIN_OTP_SENT',
      payload: { ip: req.ip },
    })
    res.json({ otpRequired: true, challengeId: challenge.id })
  })

  // Step 2: OTP. Issues the session.
  router.post('/otp', async (req, res) => {
    const { challengeId, code } = parse(otpSchema, req.body)
    const invalid = new ApiError(401, 'OTP_INVALID', 'The code is wrong or has expired')
    const challenge = await db.adminOtp.findUnique({ where: { id: challengeId } })
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt < new Date() ||
      challenge.attempts >= OTP_MAX_ATTEMPTS
    ) {
      throw invalid
    }

    if (!safeEqualHex(sha256(code), challenge.codeHash)) {
      await db.adminOtp.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      })
      await appendAudit(db, {
        actorType: 'ADMIN',
        actorId: challenge.adminId,
        action: 'ADMIN_OTP_FAILED',
        payload: { ip: req.ip },
      })
      throw invalid
    }

    // Single use, even under concurrent submissions of the same code.
    const { count } = await db.adminOtp.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    })
    if (count === 0) throw invalid

    const admin = await db.admin.findUniqueOrThrow({ where: { id: challenge.adminId } })
    const accessToken = await issueSession(db, config, res, { sub: admin.id, role: 'ADMIN' })
    await appendAudit(db, {
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'ADMIN_LOGIN_SUCCESS',
      payload: { ip: req.ip },
    })
    res.json({ accessToken, admin: { id: admin.id, name: admin.name, email: admin.email } })
  })

  return router
}
