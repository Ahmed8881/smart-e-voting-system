import type { Config } from '../config.js'
import { ApiError } from '../errors.js'

export type LivenessAction = 'BLINK' | 'TURN_LEFT' | 'TURN_RIGHT'

export type Challenge = {
  token: string
  nonce: string
  actions: LivenessAction[]
  expiresAt: number
}

export type CaptureResult = {
  nonce: string
  live: boolean
  reason: string | null
  modelVersion: string
  frameCount: number
}

export type EnrolResult = CaptureResult & { embedding: string | null }
export type VerifyResult = CaptureResult & { similarity: number | null }

export type AiClient = {
  challenge(): Promise<Challenge>
  enrol(challengeToken: string, frames: string[]): Promise<EnrolResult>
  verify(
    challengeToken: string,
    frames: string[],
    referenceEmbedding: string,
  ): Promise<VerifyResult>
}

/** HTTP client for the internal AI service. Its errors surface in our standard error shape. */
export function createAiClient(config: Config): AiClient {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(new URL(path, config.AI_SERVICE_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.AI_SERVICE_TOKEN },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new ApiError(503, 'AI_UNAVAILABLE', 'Face verification is temporarily unavailable')
    }
    const json = (await res.json().catch(() => null)) as {
      error?: { code: string; message: string }
    } | null
    if (res.status === 400 && json?.error) {
      // Client-caused (bad frames, expired challenge): pass the reason through.
      throw new ApiError(400, json.error.code, json.error.message)
    }
    if (!res.ok) {
      throw new ApiError(503, 'AI_UNAVAILABLE', 'Face verification is temporarily unavailable')
    }
    return json as T
  }

  return {
    challenge: () => call('/liveness/challenge'),
    enrol: (challengeToken, frames) => call('/face/enrol', { challengeToken, frames }),
    verify: (challengeToken, frames, referenceEmbedding) =>
      call('/face/verify', { challengeToken, frames, referenceEmbedding }),
  }
}
