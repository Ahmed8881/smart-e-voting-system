import request from 'supertest'
import { beforeEach, describe, expect, test } from 'vitest'
import type { VoterStatus } from '../../generated/prisma/client.js'
import { createAdmin, db, loginAdmin, resetDb, testApp } from '../../test/helpers.js'

let t: ReturnType<typeof testApp>
let auth: { Authorization: string }

beforeEach(async () => {
  await resetDb()
  await createAdmin()
  t = testApp()
  auth = { Authorization: `Bearer ${(await loginAdmin(t)).accessToken}` }
})

let n = 0
function voter(status: VoterStatus = 'PENDING', name?: string) {
  n++
  return db.voter.create({
    data: {
      name: name ?? `Voter ${n}`,
      email: `v${n}@test.local`,
      cnic: `35202-${2000000 + n}-1`,
      status,
    },
  })
}

describe('GET /api/admin/voters', () => {
  test('lists newest first, filters by status and searches', async () => {
    await voter('PENDING', 'Aisha Khan')
    await voter('APPROVED', 'Zainab Ali')
    await voter('PENDING', 'Bilal Ahmed')

    const all = await request(t.app).get('/api/admin/voters').set(auth)
    expect(all.body.total).toBe(3)
    expect(all.body.items[0].name).toBe('Bilal Ahmed')

    const pending = await request(t.app).get('/api/admin/voters?status=PENDING').set(auth)
    expect(pending.body.items.map((v: { name: string }) => v.name)).toEqual([
      'Bilal Ahmed',
      'Aisha Khan',
    ])

    const search = await request(t.app).get('/api/admin/voters?search=zainab').set(auth)
    expect(search.body.items).toHaveLength(1)
  })

  test('rejects an unknown status filter', async () => {
    expect((await request(t.app).get('/api/admin/voters?status=BOGUS').set(auth)).status).toBe(400)
  })

  test('requires an admin', async () => {
    expect((await request(t.app).get('/api/admin/voters')).status).toBe(401)
  })
})

describe('approve / suspend', () => {
  test.each([
    ['approve', 'PENDING', 'APPROVED'],
    ['approve', 'SUSPENDED', 'APPROVED'],
    ['approve', 'LOCKED', 'APPROVED'],
    ['suspend', 'PENDING', 'SUSPENDED'],
    ['suspend', 'APPROVED', 'SUSPENDED'],
    ['suspend', 'LOCKED', 'SUSPENDED'],
  ] as const)('%s: %s → %s, audited', async (action, from, to) => {
    const v = await voter(from)
    const res = await request(t.app).post(`/api/admin/voters/${v.id}/${action}`).set(auth)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: v.id, status: to })
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: `VOTER_${to}` } })
    expect(entry.payload).toEqual({ voterId: v.id, from, to })
  })

  test('approval records which admin approved', async () => {
    const v = await voter()
    await request(t.app).post(`/api/admin/voters/${v.id}/approve`).set(auth)
    expect((await db.voter.findUniqueOrThrow({ where: { id: v.id } })).approvedById).toEqual(
      expect.any(String),
    )
  })

  test.each([
    ['approve', 'APPROVED'],
    ['suspend', 'SUSPENDED'],
  ] as const)('%s on an already %s voter → 409', async (action, status) => {
    const v = await voter(status)
    const res = await request(t.app).post(`/api/admin/voters/${v.id}/${action}`).set(auth)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION')
  })

  test('unknown voter → 404, malformed id → 400', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    expect(
      (await request(t.app).post(`/api/admin/voters/${missing}/approve`).set(auth)).status,
    ).toBe(404)
    expect((await request(t.app).post('/api/admin/voters/nope/approve').set(auth)).status).toBe(400)
  })
})
