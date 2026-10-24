/**
 * Input fuzzing of the key endpoints (Phase 9). A seeded generator throws hostile JSON at each
 * endpoint; whatever arrives, the API must answer with a 4xx in the standard error shape —
 * never a 500 — and must not pollute Object.prototype.
 */
import request from 'supertest'
import { beforeAll, describe, expect, test } from 'vitest'
import { signAccessToken } from '../modules/auth/tokens.js'
import { createApp } from '../app.js'
import { FakeAi, createAdmin, db, fakeMailer, resetDb, testConfig } from './helpers.js'

const ITERATIONS = 40

/** Mulberry32: tiny seeded PRNG, so a failure can be replayed. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NASTY_STRINGS = [
  '',
  ' ',
  'a'.repeat(10_000),
  "' OR 1=1 --",
  '"; DROP TABLE Voter; --',
  '<script>alert(1)</script>',
  '../../../../etc/passwd',
  '\u0000\u0001\u0002',
  '🗳️'.repeat(50),
  '35202-1234567-1',
  '00000000-0000-4000-8000-000000000000',
  'not-a-uuid',
  '2026-11-01T10:00:00Z',
  'javascript:alert(1)',
  '%00%2e%2e',
  'NaN',
  '1e309',
]
const NASTY_NUMBERS = [0, -1, 1, 1.5, -0.0001, 2 ** 31, 2 ** 53, 1e308, -1e308]

function value(r: () => number, depth = 0): unknown {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!
  switch (Math.floor(r() * (depth > 3 ? 4 : 7))) {
    case 0:
      return pick(NASTY_STRINGS)
    case 1:
      return pick(NASTY_NUMBERS)
    case 2:
      return pick([null, true, false])
    case 3:
      return pick(NASTY_STRINGS).slice(0, 5)
    case 4:
      return Array.from({ length: Math.floor(r() * 4) }, () => value(r, depth + 1))
    case 5:
      return JSON.parse(
        '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
      )
    default:
      return Object.fromEntries(
        Array.from({ length: Math.floor(r() * 4) }, () => [
          pick(NASTY_STRINGS).slice(0, 8),
          value(r, depth + 1),
        ]),
      )
  }
}

/** Known field names get hostile values; sometimes fields are missing or extra ones added. */
function body(r: () => number, fields: string[]) {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (r() < 0.8) out[f] = value(r)
  if (r() < 0.3) out[`extra${Math.floor(r() * 9)}`] = value(r)
  return r() < 0.1 ? value(r) : out
}

let adminAuth: Record<string, string>
let voterAuth: Record<string, string>
let electionId: string

beforeAll(async () => {
  await resetDb()
  const admin = await createAdmin()
  const voter = await db.voter.create({
    data: { name: 'Fuzz', email: 'fuzz@test.local', cnic: '35202-7777777-1', status: 'APPROVED' },
  })
  const election = await db.election.create({
    data: {
      title: 'Fuzz election',
      description: '',
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
      createdById: admin.id,
    },
  })
  electionId = election.id
  adminAuth = {
    Authorization: `Bearer ${signAccessToken(testConfig, { sub: admin.id, role: 'ADMIN' })}`,
  }
  voterAuth = {
    Authorization: `Bearer ${signAccessToken(testConfig, { sub: voter.id, role: 'VOTER' })}`,
  }
})

// A fresh app per request, so per-IP rate limits don't hide later inputs behind 429s.
const app = () =>
  createApp({ config: testConfig, db, mailer: fakeMailer().mailer, ai: new FakeAi() })

type Target = {
  name: string
  method: 'post' | 'put' | 'patch'
  path: () => string
  auth?: () => object
  fields: string[]
}

const TARGETS: Target[] = [
  {
    name: 'admin login',
    method: 'post',
    path: () => '/api/auth/admin/login',
    fields: ['email', 'password'],
  },
  {
    name: 'admin OTP',
    method: 'post',
    path: () => '/api/auth/admin/otp',
    fields: ['challengeId', 'code'],
  },
  {
    name: 'register',
    method: 'post',
    path: () => '/api/voters/register',
    fields: ['name', 'email', 'cnic', 'challengeToken', 'frames'],
  },
  {
    name: 'voter face',
    method: 'post',
    path: () => '/api/auth/voter/face',
    fields: ['cnic', 'challengeToken', 'frames'],
  },
  {
    name: 'webauthn options',
    method: 'post',
    path: () => '/api/auth/voter/webauthn/options',
    fields: ['faceToken'],
  },
  {
    name: 'webauthn verify',
    method: 'post',
    path: () => '/api/auth/voter/webauthn/verify',
    fields: ['faceToken', 'response'],
  },
  {
    name: 'enrol verify',
    method: 'post',
    path: () => '/api/voters/me/webauthn/register/verify',
    fields: ['faceToken', 'response'],
  },
  {
    name: 'vote',
    method: 'post',
    path: () => `/api/elections/${electionId}/vote`,
    auth: () => voterAuth,
    fields: ['candidateId'],
  },
  {
    name: 'settings',
    method: 'put',
    path: () => '/api/admin/settings',
    auth: () => adminAuth,
    fields: ['fraud.maxFailedLogins', 'face.matchThreshold', '__proto__', 'toString'],
  },
  {
    name: 'create election',
    method: 'post',
    path: () => '/api/admin/elections',
    auth: () => adminAuth,
    fields: ['title', 'description', 'startsAt', 'endsAt'],
  },
  {
    name: 'add candidate',
    method: 'post',
    path: () => `/api/admin/elections/${electionId}/candidates`,
    auth: () => adminAuth,
    fields: ['name', 'party', 'symbolUrl'],
  },
  {
    name: 'review alert',
    method: 'patch',
    path: () => '/api/admin/fraud-alerts/00000000-0000-4000-8000-000000000000',
    auth: () => adminAuth,
    fields: ['status'],
  },
]

describe('hostile JSON bodies never cause a 500', () => {
  test.each(TARGETS.map((t, i) => [t.name, t, i] as const))('%s', async (_name, target, i) => {
    const r = rng(1000 + i)
    for (let n = 0; n < ITERATIONS; n++) {
      const payload = body(r, target.fields)
      const res = await request(app())
        [target.method](target.path())
        .set(target.auth?.() ?? {})
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(payload))
      if (res.status >= 500 || res.status < 400) {
        throw new Error(
          `${target.name} #${n} → ${res.status}: ${JSON.stringify(payload).slice(0, 300)}`,
        )
      }
      expect(res.body.error).toEqual({ code: expect.any(String), message: expect.any(String) })
    }
  })
})

describe('hostile query strings never cause a 500', () => {
  const QUERIES = [
    'page=-1',
    'page=abc',
    'page=1&page=2',
    'pageSize=1e309',
    'status=PENDING&status=APPROVED',
    'status=__proto__',
    'search=%27%20OR%201%3D1',
    `search=${'x'.repeat(5000)}`,
    'severity[]=HIGH',
    'status[$ne]=OPEN',
  ]
  test.each([
    '/api/admin/voters',
    '/api/admin/audit-log',
    '/api/admin/fraud-alerts',
    '/api/admin/recovery-requests',
  ])('%s', async (path) => {
    for (const q of QUERIES) {
      const res = await request(app()).get(`${path}?${q}`).set(adminAuth)
      expect(res.status, `${path}?${q}`).toBeLessThan(500)
    }
  })
})

test('malformed path ids are 400, not 500', async () => {
  for (const id of ['nope', '%00', "1' OR '1'='1", '..%2F..%2Fetc']) {
    const res = await request(app()).get(`/api/admin/elections/${id}`).set(adminAuth)
    expect(res.status, id).toBe(400)
  }
})

test('no prototype pollution after all of the above', () => {
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  expect(Object.keys(Object.prototype)).toEqual([])
})

test('an unexpected internal error is a generic 500 that leaks nothing', async () => {
  const broken = createApp({
    config: testConfig,
    mailer: fakeMailer().mailer,
    ai: new FakeAi(),
    db: new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'admin') {
          return {
            findUnique: () => Promise.reject(new Error('connect ECONNREFUSED secret-db-host:3306')),
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    }),
  })
  const res = await request(broken)
    .post('/api/auth/admin/login')
    .send({ email: 'a@b.io', password: 'x' })
  expect(res.status).toBe(500)
  expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
  expect(JSON.stringify(res.body)).not.toContain('secret-db-host')
})
