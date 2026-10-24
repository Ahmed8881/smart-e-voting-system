import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import type { Voter } from '../../generated/prisma/client.js'
import { clientInfo } from '../../lib/device.js'
import { decryptEmbedding } from '../../lib/faceCrypto.js'
import { parse } from '../../lib/validate.js'
import { appendAudit } from '../audit/audit.service.js'
import { consumeChallenge, issueChallenge } from '../face/face.service.js'
import { getSettings } from '../settings/settings.js'
import { CNIC_PATTERN, framesSchema } from '../voters/registration.routes.js'
import { issueSession, signFaceToken, verifyFaceToken, type FaceStepNext } from './tokens.js'
import { consumeWebAuthnChallenge, storeChallenge } from './webauthn.js'

const faceSchema = z.object({
  cnic: z.string().regex(CNIC_PATTERN, 'must look like 12345-1234567-1'),
  challengeToken: z.string().min(1).max(1000),
  frames: framesSchema,
})

const faceTokenSchema = z.object({ faceToken: z.string().min(1).max(2000) })

// The browser's WebAuthn JSON is checked field-by-field by the library; here only its shape/size.
const credentialResponseSchema = z.object({
  faceToken: z.string().min(1).max(2000),
  response: z
    .object({
      id: z.string().max(1024),
      rawId: z.string().max(1024),
      type: z.literal('public-key'),
      response: z.object({ clientDataJSON: z.string().max(4096) }).loose(),
      clientExtensionResults: z.object({}).loose().default({}),
    })
    .loose(),
})

const STATUS_MESSAGES: Record<Exclude<Voter['status'], 'APPROVED'>, string> = {
  PENDING: 'Your registration is waiting for administrator approval.',
  SUSPENDED: 'Your account is suspended. Please contact the election office.',
  LOCKED: 'Your account is locked for a security review. Please contact the election office.',
}

const tooMany = {
  error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' },
}

/** Mounted at /api/auth/voter — two-step voter login (UC-02) and lost-device recovery. */
export function voterAuthRouter(deps: Deps) {
  const { db, ai, config } = deps
  const router = Router()
  router.use(
    rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-8', message: tooMany }),
  )

  router.post('/challenge', async (_req, res) => {
    res.json(await issueChallenge(deps, 'LOGIN'))
  })

  // Step 1: CNIC + live face, matched 1:1 against the voter's enrolled template.
  router.post('/face', async (req, res) => {
    const { cnic, challengeToken, frames } = parse(faceSchema, req.body)
    const info = clientInfo(req, res)
    const event = (success: boolean, voterId?: string, type = 'FACE') =>
      db.authEvent.create({ data: { type, success, cnicAttempted: cnic, voterId, ...info } })
    const notVerified = new ApiError(401, 'FACE_NOT_VERIFIED', 'Face verification failed')

    const voter = await db.voter.findUnique({ where: { cnic }, include: { faceTemplate: true } })
    if (!voter?.faceTemplate) {
      await event(false)
      throw notVerified
    }
    if (voter.status !== 'APPROVED') {
      await event(false, voter.id)
      throw new ApiError(403, 'ACCOUNT_NOT_ACTIVE', STATUS_MESSAGES[voter.status])
    }

    const t = voter.faceTemplate
    const reference = decryptEmbedding(config.FACE_ENCRYPTION_KEY, voter.id, {
      ciphertext: Buffer.from(t.embeddingCiphertext),
      iv: Buffer.from(t.iv),
      authTag: Buffer.from(t.authTag),
    })
    const result = await ai.verify(challengeToken, frames, reference.toString('base64'))
    await consumeChallenge(deps, result.nonce, 'LOGIN')
    if (!result.live) {
      await event(false, voter.id, 'LIVENESS')
      throw new ApiError(422, 'LIVENESS_FAILED', 'Liveness check failed. Please try again.')
    }
    const { 'face.matchThreshold': threshold } = await getSettings(db)
    if (result.similarity === null || result.similarity < threshold) {
      await event(false, voter.id)
      throw notVerified
    }
    await event(true, voter.id)

    const activeCredentials = await db.webAuthnCredential.count({
      where: { voterId: voter.id, revokedAt: null },
    })
    const next: FaceStepNext = activeCredentials > 0 ? 'WEBAUTHN_LOGIN' : 'WEBAUTHN_ENROL'
    const recoveryPending =
      (await db.recoveryRequest.count({ where: { voterId: voter.id, status: 'PENDING' } })) > 0
    res.json({ faceToken: signFaceToken(config, voter.id, next), next, recoveryPending })
  })

  // Step 2 (returning device): WebAuthn assertion with user verification (fingerprint / PIN).
  router.post('/webauthn/options', async (req, res) => {
    const voterId = verifyFaceToken(
      config,
      parse(faceTokenSchema, req.body).faceToken,
      'WEBAUTHN_LOGIN',
    )
    const credentials = await db.webAuthnCredential.findMany({
      where: { voterId, revokedAt: null },
    })
    const options = await generateAuthenticationOptions({
      rpID: config.WEBAUTHN_RP_ID,
      allowCredentials: credentials.map((c) => ({
        id: c.credentialId,
        transports: transportsOf(c.transports),
      })),
      userVerification: 'required',
    })
    await storeChallenge(deps, voterId, 'AUTHENTICATION', options.challenge)
    res.json(options)
  })

  router.post('/webauthn/verify', async (req, res) => {
    const { faceToken, response } = parse(credentialResponseSchema, req.body)
    const voterId = verifyFaceToken(config, faceToken, 'WEBAUTHN_LOGIN')
    const info = clientInfo(req, res)
    const event = (success: boolean) =>
      db.authEvent.create({ data: { type: 'WEBAUTHN', success, voterId, ...info } })
    const failed = new ApiError(401, 'WEBAUTHN_FAILED', 'Device verification failed')

    const voter = await activeVoter(deps, voterId)
    const expectedChallenge = await consumeWebAuthnChallenge(
      deps,
      voterId,
      'AUTHENTICATION',
      response.response.clientDataJSON,
    )
    const credential = await db.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
    })
    if (!credential || credential.voterId !== voterId || credential.revokedAt) {
      await event(false)
      throw failed
    }

    let verification
    try {
      verification = await verifyAuthenticationResponse({
        response: response as never,
        expectedChallenge,
        expectedOrigin: config.WEBAUTHN_ORIGINS,
        expectedRPID: config.WEBAUTHN_RP_ID,
        credential: {
          id: credential.credentialId,
          publicKey: Uint8Array.from(credential.publicKey),
          counter: credential.signCount,
          transports: transportsOf(credential.transports),
        },
        requireUserVerification: true,
      })
    } catch (err) {
      await event(false)
      if (err instanceof Error && err.message.includes('counter value')) {
        await reportClonedCredential(deps, voterId, credential.id, err.message, info)
      }
      throw failed
    }
    if (!verification.verified) {
      await event(false)
      throw failed
    }

    await db.webAuthnCredential.update({
      where: { id: credential.id },
      data: { signCount: verification.authenticationInfo.newCounter },
    })
    await event(true)
    const accessToken = await issueSession(db, config, res, { sub: voterId, role: 'VOTER' })
    await appendAudit(db, {
      actorType: 'VOTER',
      actorId: voterId,
      action: 'VOTER_LOGIN',
      payload: { ip: info.ip },
    })
    res.json({ accessToken, voter: { id: voter.id, name: voter.name } })
  })

  // Lost device: a face-verified voter asks for an admin to allow enrolling a new device.
  router.post('/recovery', async (req, res) => {
    const voterId = verifyFaceToken(
      config,
      parse(faceTokenSchema, req.body).faceToken,
      'WEBAUTHN_LOGIN',
    )
    await activeVoter(deps, voterId)
    const existing = await db.recoveryRequest.findFirst({ where: { voterId, status: 'PENDING' } })
    if (!existing) {
      const request = await db.recoveryRequest.create({ data: { voterId } })
      await appendAudit(db, {
        actorType: 'VOTER',
        actorId: voterId,
        action: 'RECOVERY_REQUESTED',
        payload: { requestId: request.id },
      })
    }
    res.status(202).json({ status: 'PENDING' })
  })

  return router
}

/** Mounted at /api/voters/me/webauthn — first device (or replacement after recovery). */
export function voterEnrolRouter(deps: Deps) {
  const { db, config } = deps
  const router = Router()

  router.post('/register/options', async (req, res) => {
    const voterId = verifyFaceToken(
      config,
      parse(faceTokenSchema, req.body).faceToken,
      'WEBAUTHN_ENROL',
    )
    const voter = await activeVoter(deps, voterId)
    await assertNoActiveCredential(deps, voterId)
    const options = await generateRegistrationOptions({
      rpName: config.WEBAUTHN_RP_NAME,
      rpID: config.WEBAUTHN_RP_ID,
      userID: new TextEncoder().encode(voter.id),
      userName: voter.email,
      userDisplayName: voter.name,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // the phone/laptop itself, unlocked by fingerprint
        residentKey: 'preferred',
        userVerification: 'required',
      },
    })
    await storeChallenge(deps, voterId, 'REGISTRATION', options.challenge)
    res.json(options)
  })

  router.post('/register/verify', async (req, res) => {
    const { faceToken, response } = parse(credentialResponseSchema, req.body)
    const voterId = verifyFaceToken(config, faceToken, 'WEBAUTHN_ENROL')
    const voter = await activeVoter(deps, voterId)
    const expectedChallenge = await consumeWebAuthnChallenge(
      deps,
      voterId,
      'REGISTRATION',
      response.response.clientDataJSON,
    )

    let verification
    try {
      verification = await verifyRegistrationResponse({
        response: response as never,
        expectedChallenge,
        expectedOrigin: config.WEBAUTHN_ORIGINS,
        expectedRPID: config.WEBAUTHN_RP_ID,
        requireUserVerification: true,
      })
    } catch {
      throw new ApiError(400, 'WEBAUTHN_FAILED', 'Device registration failed')
    }
    if (!verification.verified)
      throw new ApiError(400, 'WEBAUTHN_FAILED', 'Device registration failed')
    const { credential } = verification.registrationInfo

    await db.$transaction(async (tx) => {
      // Lock the voter row so two simultaneous enrolments can't both pass the check.
      await tx.$queryRaw`SELECT id FROM Voter WHERE id = ${voterId} FOR UPDATE`
      if (await tx.webAuthnCredential.count({ where: { voterId, revokedAt: null } })) {
        throw new ApiError(409, 'DEVICE_ALREADY_REGISTERED', 'A device is already registered')
      }
      await tx.webAuthnCredential.create({
        data: {
          voterId,
          credentialId: credential.id,
          publicKey: Uint8Array.from(credential.publicKey),
          signCount: credential.counter,
          transports: credential.transports ?? [],
        },
      })
      await appendAudit(tx, {
        actorType: 'VOTER',
        actorId: voterId,
        action: 'WEBAUTHN_CREDENTIAL_REGISTERED',
      })
    })

    // Face (step 1) + verified device (step 2) = both factors, so the voter is now signed in.
    const accessToken = await issueSession(db, config, res, { sub: voterId, role: 'VOTER' })
    res.status(201).json({ accessToken, voter: { id: voter.id, name: voter.name } })
  })

  return router
}

async function activeVoter({ db }: Deps, voterId: string) {
  const voter = await db.voter.findUnique({ where: { id: voterId } })
  if (!voter) throw new ApiError(401, 'FACE_STEP_REQUIRED', 'Please verify your face again')
  if (voter.status !== 'APPROVED') {
    throw new ApiError(403, 'ACCOUNT_NOT_ACTIVE', STATUS_MESSAGES[voter.status])
  }
  return voter
}

async function assertNoActiveCredential({ db }: Deps, voterId: string) {
  if (await db.webAuthnCredential.count({ where: { voterId, revokedAt: null } })) {
    throw new ApiError(409, 'DEVICE_ALREADY_REGISTERED', 'A device is already registered')
  }
}

async function reportClonedCredential(
  { db }: Deps,
  voterId: string,
  credentialId: string,
  detail: string,
  info: { ip: string; deviceHash: string },
) {
  await db.fraudAlert.create({
    data: {
      voterId,
      type: 'WEBAUTHN_COUNTER_REGRESSION',
      severity: 'HIGH',
      description:
        'Device signature counter did not increase — the credential may have been cloned',
      details: { credentialRowId: credentialId, detail, ip: info.ip, deviceHash: info.deviceHash },
    },
  })
}

function transportsOf(value: unknown): AuthenticatorTransportFuture[] | undefined {
  return Array.isArray(value) ? (value as AuthenticatorTransportFuture[]) : undefined
}

type AuthenticatorTransportFuture =
  'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'
