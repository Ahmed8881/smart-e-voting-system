import request from 'supertest'
import { beforeEach, describe, expect, test } from 'vitest'
import type { ElectionStatus } from '../../generated/prisma/client.js'
import { createAdmin, db, loginAdmin, resetDb, testApp } from '../../test/helpers.js'
import { verifyChain } from '../audit/audit.service.js'

let t: ReturnType<typeof testApp>
let auth: { Authorization: string }
const HOUR = 3_600_000
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

beforeEach(async () => {
  await resetDb()
  await createAdmin()
  t = testApp()
  auth = { Authorization: `Bearer ${(await loginAdmin(t)).accessToken}` }
})

const api = {
  create: (body: object) => request(t.app).post('/api/admin/elections').set(auth).send(body),
  get: (id: string) => request(t.app).get(`/api/admin/elections/${id}`).set(auth),
  act: (id: string, action: string) =>
    request(t.app).post(`/api/admin/elections/${id}/${action}`).set(auth),
  addCandidate: (id: string, body: object) =>
    request(t.app).post(`/api/admin/elections/${id}/candidates`).set(auth).send(body),
}

const validElection = {
  title: 'Student Council President',
  description: 'Annual',
  startsAt: iso(HOUR),
  endsAt: iso(5 * HOUR),
}

async function electionWith(candidates: number) {
  const { body } = await api.create(validElection)
  for (let i = 0; i < candidates; i++) {
    await api.addCandidate(body.id, { name: `Candidate ${i}`, party: `Party ${i}` })
  }
  return body.id as string
}

/** Puts an election directly into a status, for testing what that status allows. */
async function electionIn(status: ElectionStatus) {
  const id = await electionWith(2)
  await db.election.update({ where: { id }, data: { status } })
  return id
}

describe('create / read / update / delete', () => {
  test('creates a DRAFT election, audited', async () => {
    const res = await api.create(validElection)
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ title: 'Student Council President', status: 'DRAFT' })
    expect(await db.auditLog.count({ where: { action: 'ELECTION_CREATED' } })).toBe(1)
  })

  test.each([
    [{ ...validElection, title: 'x' }, /title/],
    [{ ...validElection, endsAt: validElection.startsAt }, /endsAt: must be after startsAt/],
    [{ ...validElection, startsAt: 'tomorrow' }, /startsAt/],
    [{ ...validElection, startsAt: '2026-11-01T10:00:00' }, /startsAt/], // no timezone → ambiguous
  ])('rejects invalid input %#', async (body, message) => {
    const res = await api.create(body)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(message)
  })

  test('lists elections with candidate counts', async () => {
    await electionWith(3)
    const res = await request(t.app).get('/api/admin/elections').set(auth)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].candidateCount).toBe(3)
  })

  test('PATCH checks the merged dates', async () => {
    const id = await electionWith(0)
    const res = await request(t.app)
      .patch(`/api/admin/elections/${id}`)
      .set(auth)
      .send({ endsAt: iso(-HOUR) })
    expect(res.status).toBe(400)
    const ok = await request(t.app)
      .patch(`/api/admin/elections/${id}`)
      .set(auth)
      .send({ title: 'Renamed' })
    expect(ok.body.title).toBe('Renamed')
  })

  test('only a DRAFT can be deleted', async () => {
    const draft = await electionWith(2)
    expect((await request(t.app).delete(`/api/admin/elections/${draft}`).set(auth)).status).toBe(
      204,
    )
    const scheduled = await electionIn('SCHEDULED')
    expect(
      (await request(t.app).delete(`/api/admin/elections/${scheduled}`).set(auth)).status,
    ).toBe(409)
  })

  test('unknown id → 404, malformed → 400', async () => {
    expect((await api.get('00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await api.get('nope')).status).toBe(400)
  })
})

describe('lifecycle over HTTP', () => {
  test('DRAFT → SCHEDULED → ACTIVE → CLOSED → PUBLISHED, each step audited', async () => {
    const id = await electionWith(2)
    for (const [action, status] of [
      ['schedule', 'SCHEDULED'],
      ['open', 'ACTIVE'],
      ['close', 'CLOSED'],
      ['publish', 'PUBLISHED'],
    ]) {
      const res = await api.act(id, action!)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe(status)
    }
    expect(await db.auditLog.count({ where: { action: { startsWith: 'ELECTION_' } } })).toBe(5)
    expect((await verifyChain(db)).valid).toBe(true)
  })

  test('skipping a step is refused', async () => {
    const id = await electionWith(2)
    const res = await api.act(id, 'open')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVALID_TRANSITION')
  })

  test('scheduling needs at least two candidates', async () => {
    const id = await electionWith(1)
    expect((await api.act(id, 'schedule')).body.error.code).toBe('NOT_ENOUGH_CANDIDATES')
  })

  test('two admins opening at the same moment: exactly one succeeds', async () => {
    const id = await electionIn('SCHEDULED')
    const results = await Promise.all([api.act(id, 'open'), api.act(id, 'open')])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  })
})

describe('candidate locking', () => {
  test.each(['DRAFT', 'SCHEDULED'] as const)(
    '%s: candidates can be added, edited and removed',
    async (status) => {
      const id = await electionIn(status)
      const added = await api.addCandidate(id, {
        name: 'New Person',
        party: 'Indep.',
        symbolUrl: 'https://x.io/s.png',
      })
      expect(added.status).toBe(201)
      const cid = added.body.id
      const edited = await request(t.app)
        .patch(`/api/admin/elections/${id}/candidates/${cid}`)
        .set(auth)
        .send({ party: 'PTI' })
      expect(edited.body.party).toBe('PTI')
      expect(
        (await request(t.app).delete(`/api/admin/elections/${id}/candidates/${cid}`).set(auth))
          .status,
      ).toBe(204)
    },
  )

  test.each(['ACTIVE', 'CLOSED', 'PUBLISHED'] as const)(
    '%s: candidates and details are locked',
    async (status) => {
      const id = await electionIn(status)
      const [existing] = (await api.get(id)).body.candidates
      const responses = [
        await api.addCandidate(id, { name: 'Late Entry', party: 'X' }),
        await request(t.app)
          .patch(`/api/admin/elections/${id}/candidates/${existing.id}`)
          .set(auth)
          .send({ name: 'Changed' }),
        await request(t.app)
          .delete(`/api/admin/elections/${id}/candidates/${existing.id}`)
          .set(auth),
        await request(t.app)
          .patch(`/api/admin/elections/${id}`)
          .set(auth)
          .send({ title: 'Changed title' }),
      ]
      for (const res of responses) {
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('ELECTION_LOCKED')
      }
      expect(await db.candidate.count({ where: { electionId: id } })).toBe(2)
    },
  )

  test('symbol must be an https URL', async () => {
    const id = await electionWith(0)
    const res = await api.addCandidate(id, {
      name: 'A Person',
      party: 'X',
      symbolUrl: 'javascript:alert(1)',
    })
    expect(res.status).toBe(400)
  })

  test('a candidate id from another election is not found', async () => {
    const a = await electionWith(1)
    const b = await electionWith(0)
    const [candidate] = (await api.get(a)).body.candidates
    const res = await request(t.app)
      .delete(`/api/admin/elections/${b}/candidates/${candidate.id}`)
      .set(auth)
    expect(res.status).toBe(404)
  })
})

test('voters cannot use the admin elections API', async () => {
  expect((await request(t.app).get('/api/admin/elections')).status).toBe(401)
})
