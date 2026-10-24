import request from 'supertest'
import { beforeEach, describe, expect, test } from 'vitest'
import { createAdmin, db, loginAdmin, resetDb, testApp, testConfig } from '../../test/helpers.js'
import { signAccessToken } from '../auth/tokens.js'

let t: ReturnType<typeof testApp>
let adminAuth: { Authorization: string }
const HOUR = 3_600_000
let seq = 0

beforeEach(async () => {
  await resetDb()
  await createAdmin()
  t = testApp()
  adminAuth = { Authorization: `Bearer ${(await loginAdmin(t)).accessToken}` }
})

async function voterAuth() {
  seq++
  const v = await db.voter.create({
    data: {
      name: `V${seq}`,
      email: `r${seq}@test.local`,
      cnic: `35202-${4000000 + seq}-1`,
      status: 'APPROVED',
    },
  })
  return { Authorization: `Bearer ${signAccessToken(testConfig, { sub: v.id, role: 'VOTER' })}` }
}

/** Active election with candidates Aisha, Bilal, Zainab and the given votes (by candidate index). */
async function activeElectionWithVotes(votesFor: number[]) {
  const admin = await db.admin.findFirstOrThrow()
  const e = await db.election.create({
    data: {
      title: 'Council President',
      description: '',
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - HOUR),
      endsAt: new Date(Date.now() + HOUR),
      createdById: admin.id,
      candidates: {
        create: ['Aisha', 'Bilal', 'Zainab'].map((name) => ({
          name,
          party: `${name} Party`,
          createdById: admin.id,
        })),
      },
    },
    include: { candidates: { orderBy: { name: 'asc' } } },
  })
  const voters = []
  for (const index of votesFor) {
    const auth = await voterAuth()
    voters.push(auth)
    const res = await request(t.app)
      .post(`/api/elections/${e.id}/vote`)
      .set(auth)
      .send({ candidateId: e.candidates[index]!.id })
    expect(res.status).toBe(201)
  }
  return { e, voters }
}

const admin = {
  results: (id: string) => request(t.app).get(`/api/admin/elections/${id}/results`).set(adminAuth),
  turnout: (id: string) => request(t.app).get(`/api/admin/elections/${id}/turnout`).set(adminAuth),
  act: (id: string, action: string) =>
    request(t.app).post(`/api/admin/elections/${id}/${action}`).set(adminAuth),
}

describe('while voting is open', () => {
  test('admins see turnout only; per-candidate results are hidden from everyone', async () => {
    const { e, voters } = await activeElectionWithVotes([0, 2, 2])
    await voterAuth() // an approved voter who hasn't voted

    expect((await admin.turnout(e.id)).body).toEqual({ voted: 3, eligible: 4, percent: 75 })
    const hidden = await admin.results(e.id)
    expect(hidden.status).toBe(409)
    expect(hidden.body.error.code).toBe('RESULTS_HIDDEN')
    const voterView = await request(t.app).get(`/api/elections/${e.id}/results`).set(voters[0]!)
    expect(voterView.status).toBe(403)
    expect(await db.resultTally.count()).toBe(0)
  })
})

describe('closing and publishing', () => {
  test('close computes the tally (zero-vote candidates included); admins see it before voters', async () => {
    const { e, voters } = await activeElectionWithVotes([2, 0, 2, 2])
    expect((await admin.act(e.id, 'close')).status).toBe(200)

    const res = await admin.results(e.id)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'CLOSED', totalVotes: 4, consistent: true })
    expect(
      res.body.results.map((r: { name: string; votes: number; percent: number }) => [
        r.name,
        r.votes,
        r.percent,
      ]),
    ).toEqual([
      ['Zainab', 3, 75],
      ['Aisha', 1, 25],
      ['Bilal', 0, 0],
    ])
    expect(res.body.turnout).toEqual({ voted: 4, eligible: 4, percent: 100 })
    // Not yet published:
    expect(
      (await request(t.app).get(`/api/elections/${e.id}/results`).set(voters[0]!)).status,
    ).toBe(403)
  })

  test('after publishing, voters see results (without internal fields)', async () => {
    const { e, voters } = await activeElectionWithVotes([1, 1])
    await admin.act(e.id, 'close')
    await admin.act(e.id, 'publish')
    const res = await request(t.app).get(`/api/elections/${e.id}/results`).set(voters[0]!)
    expect(res.status).toBe(200)
    expect(res.body.totalVotes).toBe(2)
    expect(res.body.results[0]).toMatchObject({ name: 'Bilal', votes: 2, percent: 100 })
    expect(res.body).not.toHaveProperty('consistent')
    const published = await request(t.app).get('/api/elections/published').set(voters[0]!)
    expect(published.body).toEqual([{ id: e.id, title: e.title, endsAt: expect.any(String) }])
  })

  test('turnout after close uses the eligible count frozen at closing time', async () => {
    const { e } = await activeElectionWithVotes([0])
    await admin.act(e.id, 'close')
    await voterAuth() // approved later
    expect((await admin.turnout(e.id)).body).toEqual({ voted: 1, eligible: 1, percent: 100 })
  })
})

describe('integrity', () => {
  test('an extra ballot without a voter at close time raises a HIGH alert', async () => {
    const { e } = await activeElectionWithVotes([0, 1])
    await db.ballot.create({
      data: { id: crypto.randomUUID(), electionId: e.id, candidateId: e.candidates[0]!.id },
    })
    await admin.act(e.id, 'close')
    expect(await db.fraudAlert.findFirstOrThrow()).toMatchObject({
      type: 'TALLY_MISMATCH',
      severity: 'HIGH',
    })
  })

  test('deleting a participation after close is visible as inconsistent', async () => {
    const { e } = await activeElectionWithVotes([0, 1])
    await admin.act(e.id, 'close')
    await db.participation.deleteMany({ where: { electionId: e.id } })
    expect((await admin.results(e.id)).body.consistent).toBe(false)
  })
})
