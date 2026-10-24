import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import { Prisma } from '../../generated/prisma/client.js'
import { clientInfo } from '../../lib/device.js'
import { embeddingFromBase64 } from '../../lib/embedding.js'
import { encryptEmbedding } from '../../lib/faceCrypto.js'
import { parse } from '../../lib/validate.js'
import { appendAudit } from '../audit/audit.service.js'
import { consumeChallenge, findMatchingFace, issueChallenge } from '../face/face.service.js'
import { getSettings } from '../settings/settings.js'

export const CNIC_PATTERN = /^\d{5}-\d{7}-\d$/

export const framesSchema = z
  .array(z.string().max(700_000))
  .min(6, 'at least 6 frames are required')
  .max(30)

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  cnic: z.string().regex(CNIC_PATTERN, 'must look like 12345-1234567-1'),
  challengeToken: z.string().min(1).max(1000),
  frames: framesSchema,
})

const tooMany = {
  error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' },
}

export function registrationRouter(deps: Deps) {
  const { db, ai, config } = deps
  const router = Router()
  router.use(
    rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', message: tooMany }),
  )

  router.post('/challenge', async (_req, res) => {
    res.json(await issueChallenge(deps, 'REGISTRATION'))
  })

  router.post('/', async (req, res) => {
    const input = parse(registerSchema, req.body)
    const info = clientInfo(req, res)
    const event = (success: boolean, voterId?: string) =>
      db.authEvent.create({
        data: { type: 'REGISTRATION', success, cnicAttempted: input.cnic, voterId, ...info },
      })

    // Cheap uniqueness check first, so an obvious duplicate doesn't cost a face analysis.
    // The unique constraints below are what actually guarantee it under concurrency.
    await assertUnique(deps, input.email, input.cnic)

    const result = await ai.enrol(input.challengeToken, input.frames)
    await consumeChallenge(deps, result.nonce, 'REGISTRATION')
    if (!result.live || !result.embedding) {
      await event(false)
      throw new ApiError(422, 'LIVENESS_FAILED', livenessMessage(result.reason))
    }

    const embedding = embeddingFromBase64(result.embedding)
    const settings = await getSettings(db)
    const duplicate = await findMatchingFace(deps, embedding, settings['face.matchThreshold'])
    if (duplicate) {
      await event(false)
      await db.fraudAlert.create({
        data: {
          type: 'DUPLICATE_FACE_REGISTRATION',
          severity: 'HIGH',
          score: duplicate.similarity,
          description: 'A new registration matched the face of an existing voter',
          details: {
            matchedVoterId: duplicate.voterId,
            similarity: duplicate.similarity,
            attemptedEmail: input.email,
            ip: info.ip,
            deviceHash: info.deviceHash,
          },
          voterId: duplicate.voterId,
        },
      })
      // Deliberately vague: don't confirm to the registrant whose face it matched.
      throw new ApiError(409, 'DUPLICATE_FACE', 'This person appears to be registered already')
    }

    const voter = await db
      .$transaction(async (tx) => {
        const created = await tx.voter.create({
          data: { name: input.name, email: input.email, cnic: input.cnic },
        })
        const enc = encryptEmbedding(config.FACE_ENCRYPTION_KEY, created.id, embedding)
        await tx.faceTemplate.create({
          data: {
            voterId: created.id,
            embeddingCiphertext: Uint8Array.from(enc.ciphertext),
            iv: Uint8Array.from(enc.iv),
            authTag: Uint8Array.from(enc.authTag),
            modelVersion: result.modelVersion,
          },
        })
        await appendAudit(tx, {
          actorType: 'VOTER',
          actorId: created.id,
          action: 'VOTER_REGISTERED',
        })
        return created
      })
      .catch((err) => {
        throw uniqueViolation(err) ?? err
      })

    await event(true, voter.id)
    res.status(201).json({ id: voter.id, status: voter.status })
  })

  return router
}

async function assertUnique({ db }: Deps, email: string, cnic: string) {
  const existing = await db.voter.findFirst({
    where: { OR: [{ email }, { cnic }] },
    select: { email: true },
  })
  if (existing) {
    const field = existing.email === email ? 'email' : 'CNIC'
    throw new ApiError(
      409,
      'ALREADY_REGISTERED',
      `A voter with this ${field} is already registered`,
    )
  }
}

function uniqueViolation(err: unknown): ApiError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new ApiError(
      409,
      'ALREADY_REGISTERED',
      'A voter with this email or CNIC is already registered',
    )
  }
  return null
}

const LIVENESS_MESSAGES: Record<string, string> = {
  FACE_NOT_CLEAR: 'We could not see your face clearly. Face the camera in good light.',
  IDENTITY_CHANGED: 'More than one person appeared during the check.',
  MULTIPLE_FACES: 'Only one person may be in front of the camera.',
  FACE_NOT_TRACKED: 'Keep your face in the frame for the whole check.',
  TOO_FEW_FRAMES: 'The capture was too short. Please try again.',
}

function livenessMessage(reason: string | null): string {
  if (reason?.startsWith('ACTION_NOT_DETECTED')) {
    return 'We did not see you follow the on-screen instructions. Please try again.'
  }
  return (reason && LIVENESS_MESSAGES[reason]) ?? 'Liveness check failed. Please try again.'
}
