import type { Deps } from '../../app.js'
import type { ChallengePurpose } from '../../generated/prisma/client.js'
import { ApiError } from '../../errors.js'
import { cosine } from '../../lib/embedding.js'
import { decryptEmbedding } from '../../lib/faceCrypto.js'

/** Gets a liveness challenge from the AI service and records its nonce for single use. */
export async function issueChallenge({ db, ai }: Deps, purpose: ChallengePurpose) {
  const challenge = await ai.challenge()
  await db.livenessChallenge.create({
    data: { nonce: challenge.nonce, purpose, expiresAt: new Date(challenge.expiresAt * 1000) },
  })
  return {
    challengeToken: challenge.token,
    actions: challenge.actions,
    expiresAt: challenge.expiresAt,
  }
}

/**
 * Marks a challenge used. Conditional update, so of two concurrent submissions of the same
 * capture only one gets through. Unknown nonces (not issued by us for this purpose) fail too.
 */
export async function consumeChallenge({ db }: Deps, nonce: string, purpose: ChallengePurpose) {
  const { count } = await db.livenessChallenge.updateMany({
    where: { nonce, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  if (count === 0) {
    throw new ApiError(
      400,
      'CHALLENGE_USED',
      'This face capture was already used; please try again',
    )
  }
}

/**
 * 1:N search over every enrolled face. Returns the closest match at or above the threshold.
 * shortcut: decrypts all templates per call — fine for thousands of voters; past ~100k use an
 * in-memory index rebuilt at startup.
 */
export async function findMatchingFace(
  { db, config }: Deps,
  embedding: Buffer,
  threshold: number,
): Promise<{ voterId: string; similarity: number } | null> {
  const templates = await db.faceTemplate.findMany({
    select: { voterId: true, embeddingCiphertext: true, iv: true, authTag: true },
  })
  let best: { voterId: string; similarity: number } | null = null
  for (const t of templates) {
    const stored = decryptEmbedding(config.FACE_ENCRYPTION_KEY, t.voterId, {
      ciphertext: Buffer.from(t.embeddingCiphertext),
      iv: Buffer.from(t.iv),
      authTag: Buffer.from(t.authTag),
    })
    const similarity = cosine(embedding, stored)
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { voterId: t.voterId, similarity }
    }
  }
  return best
}
