/**
 * Concurrent-voting load test (SRS 2.4.2 scalability). Runs the real app over real HTTP against
 * the TEST database (which it wipes), then checks the one-person-one-vote invariants.
 *
 *   npm run load-test -- [voters=500] [concurrency=50]
 *
 * Every voter casts one vote, and 20 % of them immediately try a second one, so the database
 * constraint is exercised under load too.
 */
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createDb } from '../src/db.js'
import { signAccessToken } from '../src/modules/auth/tokens.js'

const [voters = 500, concurrency = 50] = process.argv.slice(2).map(Number)
const testUrl = process.env.TEST_DATABASE_URL
if (!testUrl || !/test/i.test(new URL(testUrl).pathname)) {
  throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test"')
}

const config = loadConfig({ ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test' })
const db = createDb(testUrl)
const noMail = { send: async () => {} }
const noAi = new Proxy({}, { get: () => () => Promise.reject(new Error('not used')) })

async function wipe() {
  await db.$transaction([
    db.resultTally.deleteMany(),
    db.ballot.deleteMany(),
    db.participation.deleteMany(),
    db.candidate.deleteMany(),
    db.fraudAlert.deleteMany(),
    db.election.deleteMany(),
    db.voter.deleteMany(),
    db.admin.deleteMany(),
  ])
}

async function main() {
  await wipe()
  const admin = await db.admin.create({
    data: { name: 'Load', email: 'load@test.local', passwordHash: 'x' },
  })
  const election = await db.election.create({
    data: {
      title: 'Load test',
      description: '',
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
      createdById: admin.id,
      candidates: {
        create: ['A', 'B', 'C'].map((name) => ({ name, party: name, createdById: admin.id })),
      },
    },
    include: { candidates: true },
  })
  await db.voter.createMany({
    data: Array.from({ length: voters }, (_, i) => ({
      id: randomUUID(),
      name: `Load ${i}`,
      email: `load${i}@test.local`,
      cnic: `9${String(i).padStart(4, '0')}-${String(i).padStart(7, '0')}-1`,
      status: 'APPROVED' as const,
    })),
  })
  const ids = (await db.voter.findMany({ select: { id: true } })).map((v) => v.id)

  // No rate limiting by IP here would distort the test: every request comes from 127.0.0.1.
  const app = createApp({ config, db, mailer: noMail, ai: noAi as never })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const jobs = ids.flatMap((id, i) => {
    const token = signAccessToken(config, { sub: id, role: 'VOTER' })
    const vote = () =>
      fetch(`${base}/api/elections/${election.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId: election.candidates[i % 3]!.id }),
      })
    return i % 5 === 0 ? [vote, vote] : [vote] // 20 % try twice
  })

  const latencies: number[] = []
  const statuses = new Map<number, number>()
  let next = 0
  const started = performance.now()
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!
        const t0 = performance.now()
        const res = await job()
        latencies.push(performance.now() - t0)
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1)
      }
    }),
  )
  const seconds = (performance.now() - started) / 1000
  server.close()

  latencies.sort((a, b) => a - b)
  const pct = (p: number) =>
    latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]!.toFixed(0)
  const [ballots, participations, alerts] = await Promise.all([
    db.ballot.count({ where: { electionId: election.id } }),
    db.participation.count({ where: { electionId: election.id } }),
    db.fraudAlert.count({ where: { type: 'REPEAT_VOTE_ATTEMPT' } }),
  ])

  console.log(`requests        ${jobs.length} (${voters} voters, concurrency ${concurrency})`)
  console.log(`statuses        ${[...statuses].map(([s, n]) => `${s}×${n}`).join('  ')}`)
  console.log(
    `throughput      ${(jobs.length / seconds).toFixed(0)} req/s over ${seconds.toFixed(1)} s`,
  )
  console.log(
    `latency (ms)    p50 ${pct(50)}  p95 ${pct(95)}  p99 ${pct(99)}  max ${latencies.at(-1)!.toFixed(0)}`,
  )
  console.log(
    `ballots         ${ballots}   participations ${participations}   repeat-vote alerts ${alerts}`,
  )

  const ok =
    ballots === voters &&
    participations === voters &&
    statuses.get(201) === voters &&
    !statuses.has(500)
  console.log(ok ? 'PASS: exactly one ballot per voter, no server errors' : 'FAIL')
  await wipe()
  await db.$disconnect()
  process.exit(ok ? 0 : 1)
}

void main()
