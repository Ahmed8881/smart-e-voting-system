import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type EncryptedEmbedding = { ciphertext: Buffer; iv: Buffer; authTag: Buffer }

const ALGORITHM = 'aes-256-gcm'

// The voter id is bound in as authenticated data, so a ciphertext copied onto another voter's
// row fails to decrypt instead of silently matching the wrong person.
const aad = (voterId: string) => Buffer.from(`face-embedding:${voterId}`)

export function encryptEmbedding(
  key: Buffer,
  voterId: string,
  embedding: Buffer,
): EncryptedEmbedding {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(aad(voterId))
  const ciphertext = Buffer.concat([cipher.update(embedding), cipher.final()])
  return { ciphertext, iv, authTag: cipher.getAuthTag() }
}

/** Throws if the data, IV, tag or voter binding has been tampered with. */
export function decryptEmbedding(key: Buffer, voterId: string, data: EncryptedEmbedding): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, data.iv)
  decipher.setAAD(aad(voterId))
  decipher.setAuthTag(data.authTag)
  return Buffer.concat([decipher.update(data.ciphertext), decipher.final()])
}
