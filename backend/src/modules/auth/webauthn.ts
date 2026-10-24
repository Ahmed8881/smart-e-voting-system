import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import type { WebAuthnCeremony } from '../../generated/prisma/client.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export async function storeChallenge(
  { db }: Deps,
  voterId: string,
  ceremony: WebAuthnCeremony,
  challenge: string,
) {
  await db.webAuthnChallenge.create({
    data: { voterId, ceremony, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  })
}

/**
 * Atomically consumes the challenge the browser signed. Returns it for the library to check
 * against the signed clientDataJSON; a challenge we never issued, or one already used, fails.
 */
export async function consumeWebAuthnChallenge(
  { db }: Deps,
  voterId: string,
  ceremony: WebAuthnCeremony,
  clientDataJSON: string,
): Promise<string> {
  const invalid = new ApiError(400, 'WEBAUTHN_CHALLENGE_INVALID', 'Please start again')
  let challenge: string
  try {
    challenge = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')).challenge
  } catch {
    throw invalid
  }
  if (typeof challenge !== 'string') throw invalid
  const { count } = await db.webAuthnChallenge.updateMany({
    where: { voterId, ceremony, challenge, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  if (count === 0) throw invalid
  return challenge
}
