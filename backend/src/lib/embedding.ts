/** Face embeddings travel as base64 of 128 little-endian float32 values (512 bytes). */
export const EMBEDDING_BYTES = 128 * 4

export function embeddingFromBase64(b64: string): Buffer {
  const buf = Buffer.from(b64, 'base64')
  if (buf.length !== EMBEDDING_BYTES) throw new Error('Embedding must be 128 float32 values')
  return buf
}

/** Cosine similarity. The AI service returns unit-length vectors, but normalise anyway. */
export function cosine(a: Buffer, b: Buffer): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < EMBEDDING_BYTES; i += 4) {
    const x = a.readFloatLE(i)
    const y = b.readFloatLE(i)
    dot += x * y
    na += x * x
    nb += y * y
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
