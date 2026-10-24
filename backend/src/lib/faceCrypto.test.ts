import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { decryptEmbedding, encryptEmbedding } from './faceCrypto.js'

const key = randomBytes(32)
const embedding = Buffer.from(new Float32Array(128).map((_, i) => i / 128).buffer)

describe('face embedding encryption (AES-256-GCM)', () => {
  test('round-trips', () => {
    const enc = encryptEmbedding(key, 'voter-1', embedding)
    expect(decryptEmbedding(key, 'voter-1', enc).equals(embedding)).toBe(true)
  })

  test('ciphertext does not contain the plaintext and IVs are never reused', () => {
    const a = encryptEmbedding(key, 'voter-1', embedding)
    const b = encryptEmbedding(key, 'voter-1', embedding)
    expect(a.ciphertext.equals(embedding)).toBe(false)
    expect(a.iv.equals(b.iv)).toBe(false)
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false)
  })

  test('tampered ciphertext is rejected', () => {
    const enc = encryptEmbedding(key, 'voter-1', embedding)
    enc.ciphertext[0]! ^= 1
    expect(() => decryptEmbedding(key, 'voter-1', enc)).toThrow()
  })

  test('a ciphertext moved to another voter is rejected', () => {
    const enc = encryptEmbedding(key, 'voter-1', embedding)
    expect(() => decryptEmbedding(key, 'voter-2', enc)).toThrow()
  })

  test('the wrong key is rejected', () => {
    const enc = encryptEmbedding(key, 'voter-1', embedding)
    expect(() => decryptEmbedding(randomBytes(32), 'voter-1', enc)).toThrow()
  })
})
