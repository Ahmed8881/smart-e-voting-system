import request from 'supertest'
import { beforeEach, describe, expect, test } from 'vitest'
import type { ElectionStatus, VoterStatus } from '../../generated/prisma/client.js'
import { createAdmin, db, loginAdmin, resetDb, testApp, testConfig } from '../../test/helpers.js'
import { signAccessToken } from '../auth/tokens.js'

let t: ReturnType<typeof testApp>
const HOUR = 3_600_000
let seq = 0

beforeEach(async () => {
  await resetDb()
  t = testApp()
})

async function signedInVoter(status: VoterStatus = 'APPROVED') {
  seq++
  const voter = await db.voter.create({
    data: {
      name: `Voter ${seq}`,
      email: `v${seq}@test.local`,
      cnic: `35202-${3000000 + seq}-1`,
      status,
    },
  })
  const token = signAccessToken(testConfig, { sub: voter.id, role: 'VOTER' })
  return { voter, auth: { Authorization: `Bearer ${token}` } }
}

async function election(
  status: ElectionStatus = 'ACTIVE',
  window = { startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + HOUR) },
) {
  const admin = (await db.admin.findFirst()) ?? (await createAdmin())
  return db.election.create({
    data: {
      title: `Election ${++seq}`,
      description: '',
      status,
      ...window,
      createdById: admin.id,
      candidates: {
        create: [
          { name: 'Aisha', party: 'Blue', createdById: admin.id },
          { name: 'Zainab', party: 'Green', createdById: admin.id },
        ],
      },
    },
    include: { candidates: { orderBy: { name: 'asc' } } },
  })
}

const vote = (auth: object, electionId: string, candidateId: string) =>
  request(t.app).post(`/api/elections/${electionId}/vote`).set(auth).send({ candidateId })

describe('casting a vote', () => {
  test('records participation and an anonymous ballot in one go', async () => {
    const { voter, auth } = await signedInVoter()
    const e = await election()
    const res = await vote(auth, e.id, e.candidates[0]!.id)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ recorded: true }) // no candidate echoed back

    const participation = await db.participation.findMany()
    expect(participation).toEqual([
      { voterId: voter.id, electionId: e.id, votedAt: expect.any(Date) },
    ])
    const ballots = await db.ballot.findMany()
    expect(ballots).toHaveLength(1)
    // The ballot row has exactly these columns: nothing that links it to a voter or a time.
    expect(Object.keys(ballots[0]!).sort()).toEqual(['candidateId', 'electionId', 'id'])
    expect(ballots[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  test('ballot ids are random, so their order says nothing about when votes were cast', async () => {
    const e = await election()
    for (let i = 0; i < 12; i++) {
      const { auth } = await signedInVoter()
      await vote(auth, e.id, e.candidates[i % 2]!.id)
    }
    const castOrder = (await db.participation.findMany({ orderBy: { votedAt: 'asc' } })).length
    const idOrder = (await db.ballot.findMany({ orderBy: { id: 'asc' } })).map((b) => b.id)
    expect(castOrder).toBe(12)
    expect(new Set(idOrder).size).toBe(12)
    // v4 UUIDs: no shared time-based prefix as sequential/time-ordered ids would have.
    expect(new Set(idOrder.map((id) => id.slice(0, 4))).size).toBeGreaterThan(6)
  })

  test('voting twice → 409, still exactly one ballot, MEDIUM fraud alert', async () => {
    const { voter, auth } = await signedInVoter()
    const e = await election()
    await vote(auth, e.id, e.candidates[0]!.id)
    const again = await vote(auth, e.id, e.candidates[1]!.id)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('ALREADY_VOTED')
    expect(await db.ballot.count()).toBe(1)
    expect(await db.fraudAlert.findFirstOrThrow()).toMatchObject({
      type: 'REPEAT_VOTE_ATTEMPT',
      severity: 'MEDIUM',
      voterId: voter.id,
      electionId: e.id,
    })
  })

  test('10 simultaneous votes from one voter produce exactly one ballot', async () => {
    const { auth } = await signedInVoter()
    const e = await election()
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => vote(auth, e.id, e.candidates[i % 2]!.id)),
    )
    const statuses = results.map((r) => r.status)
    expect(statuses.filter((s) => s === 201)).toHaveLength(1)
    expect(statuses.filter((s) => s === 409)).toHaveLength(9)
    expect(await db.ballot.count()).toBe(1)
    expect(await db.participation.count()).toBe(1)
  })

  test('voting while an admin closes the election never leaves a ballot without participation', async () => {
    await createAdmin()
    const adminAuth = { Authorization: `Bearer ${(await loginAdmin(t)).accessToken}` }
    const e = await election()
    const voters = await Promise.all(Array.from({ length: 6 }, () => signedInVoter()))
    await Promise.all([
      ...voters.map(({ auth }, i) => vote(auth, e.id, e.candidates[i % 2]!.id)),
      request(t.app).post(`/api/admin/elections/${e.id}/close`).set(adminAuth),
    ])
    expect(await db.ballot.count()).toBe(await db.participation.count())
    expect((await db.election.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('CLOSED')
  })

  test('a candidate from another election is refused and nothing is written', async () => {
    const { auth } = await signedInVoter()
    const a = await election()
    const b = await election()
    const res = await vote(auth, a.id, b.candidates[0]!.id)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_CANDIDATE')
    expect(await db.participation.count()).toBe(0)
  })

  test.each(['DRAFT', 'SCHEDULED', 'CLOSED', 'PUBLISHED'] as const)(
    '%s election → 409',
    async (status) => {
      const { auth } = await signedInVoter()
      const e = await election(status)
      expect((await vote(auth, e.id, e.candidates[0]!.id)).body.error.code).toBe(
        'ELECTION_NOT_OPEN',
      )
    },
  )

  test.each([
    [
      'before it starts',
      { startsAt: new Date(Date.now() + HOUR), endsAt: new Date(Date.now() + 2 * HOUR) },
    ],
    [
      'after it ends',
      { startsAt: new Date(Date.now() - 2 * HOUR), endsAt: new Date(Date.now() - 1) },
    ],
  ])('ACTIVE but %s → 409', async (_label, window) => {
    const { auth } = await signedInVoter()
    const e = await election('ACTIVE', window)
    expect((await vote(auth, e.id, e.candidates[0]!.id)).status).toBe(409)
  })

  test.each(['SUSPENDED', 'LOCKED', 'PENDING'] as const)(
    'a %s voter with a still-valid token cannot vote',
    async (status) => {
      const { auth } = await signedInVoter(status)
      const e = await election()
      expect((await vote(auth, e.id, e.candidates[0]!.id)).status).toBe(403)
    },
  )

  test('admins and anonymous users cannot vote', async () => {
    const e = await election()
    const admin = await db.admin.findFirstOrThrow()
    const adminToken = signAccessToken(testConfig, { sub: admin.id, role: 'ADMIN' })
    expect(
      (await vote({ Authorization: `Bearer ${adminToken}` }, e.id, e.candidates[0]!.id)).status,
    ).toBe(403)
    expect((await vote({}, e.id, e.candidates[0]!.id)).status).toBe(401)
  })
})

describe('viewing', () => {
  test('active elections show whether I have voted', async () => {
    const { auth } = await signedInVoter()
    const e = await election()
    await election('SCHEDULED')
    const before = await request(t.app).get('/api/elections/active').set(auth)
    expect(before.body).toHaveLength(1)
    expect(before.body[0]).toMatchObject({ id: e.id, hasVoted: false, open: true })
    await vote(auth, e.id, e.candidates[0]!.id)
    const after = await request(t.app).get('/api/elections/active').set(auth)
    expect(after.body[0].hasVoted).toBe(true)
  })

  test('the ballot lists candidates; a DRAFT election is not visible', async () => {
    const { auth } = await signedInVoter()
    const e = await election()
    const res = await request(t.app).get(`/api/elections/${e.id}/candidates`).set(auth)
    expect(res.body.candidates.map((c: { name: string }) => c.name)).toEqual(['Aisha', 'Zainab'])
    const draft = await election('DRAFT')
    expect(
      (await request(t.app).get(`/api/elections/${draft.id}/candidates`).set(auth)).status,
    ).toBe(404)
  })

  test('vote history shows where and when, never who for', async () => {
    const { auth } = await signedInVoter()
    const e = await election()
    await vote(auth, e.id, e.candidates[1]!.id)
    const res = await request(t.app).get('/api/me/participation').set(auth)
    expect(res.body).toEqual([
      { id: e.id, title: e.title, status: 'ACTIVE', votedAt: expect.any(String) },
    ])
    expect(JSON.stringify(res.body)).not.toContain(e.candidates[1]!.id)
  })
})
