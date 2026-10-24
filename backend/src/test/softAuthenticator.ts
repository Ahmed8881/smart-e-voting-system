/**
 * A software WebAuthn authenticator for tests: real P-256 keys, real CBOR attestation and real
 * ECDSA assertions, so the server runs SimpleWebAuthn's full verification — no mocking.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'

type CborValue = number | string | Uint8Array | Map<CborValue, CborValue>

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n])
  if (n < 0x10000) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff])
  const b = Buffer.alloc(5)
  b[0] = (major << 5) | 26
  b.writeUInt32BE(n, 1)
  return b
}

/** Minimal CBOR encoder: ints, text, byte strings and maps — all WebAuthn needs. */
export function cbor(value: CborValue): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8')
    return Buffer.concat([head(3, bytes.length), bytes])
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value])
  const parts = [head(5, value.size)]
  for (const [k, v] of value) parts.push(cbor(k), cbor(v))
  return Buffer.concat(parts)
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest()

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_AT = 0x40

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16)
  private readonly privateKey: KeyObject
  private readonly cosePublicKey: Buffer
  counter = 0

  constructor(
    private readonly rpId = 'localhost',
    private readonly origin = 'http://localhost:5173',
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    this.privateKey = privateKey
    const jwk = publicKey.export({ format: 'jwk' })
    this.cosePublicKey = cbor(
      new Map<CborValue, CborValue>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    )
  }

  get id() {
    return b64url(this.credentialId)
  }

  private authData(flags: number, extra: Buffer = Buffer.alloc(0)) {
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(this.counter)
    return Buffer.concat([sha256(this.rpId), Buffer.from([flags]), counter, extra])
  }

  private clientData(type: string, challenge: string, origin = this.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
  }

  /** navigator.credentials.create() */
  register(options: { challenge: string }) {
    const credentialData = Buffer.concat([
      Buffer.alloc(16), // AAGUID
      Buffer.from([0, this.credentialId.length]),
      this.credentialId,
      this.cosePublicKey,
    ])
    const attestationObject = cbor(
      new Map<CborValue, CborValue>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', this.authData(FLAG_UP | FLAG_UV | FLAG_AT, credentialData)],
      ]),
    )
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    }
  }

  /**
   * navigator.credentials.get(). `cloned` replays the current counter instead of incrementing it,
   * like a copied key would; `userVerified: false` is a device unlocked without fingerprint/PIN.
   */
  authenticate(
    options: { challenge: string },
    {
      cloned = false,
      userVerified = true,
      origin,
    }: { cloned?: boolean; userVerified?: boolean; origin?: string } = {},
  ) {
    if (!cloned) this.counter++
    const authenticatorData = this.authData(FLAG_UP | (userVerified ? FLAG_UV : 0))
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, origin)
    const signature = sign(
      'sha256',
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      this.privateKey,
    )
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
    }
  }
}
