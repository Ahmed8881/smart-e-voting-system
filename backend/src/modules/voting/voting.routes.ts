import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import { Prisma } from '../../generated/prisma/client.js'
import { authOf, requireRole } from '../../middleware/auth.js'
import { parse } from '../../lib/validate.js'
import { isAcceptingVotes } from '../elections/lifecycle.js'
import { getResults, getTurnout } from '../results/results.service.js'

const idSchema = z.object({ id: z.uuid() })
const voteSchema = z.object({ candidateId: z.uuid() })

/** Mounted at /api/elections (role VOTER). UC-03, UC-04, UC-05. */
export function votingRouter({ db, config }: Deps) {
  const router = Router()
  router.use(requireRole(config, 'VOTER'))

  // UC-03: open elections, with whether this voter has already voted in each.
  router.get('/active', async (req, res) => {
    const voterId = authOf(req).sub
    const now = new Date()
    const elections = await db.election.findMany({
      where: { status: 'ACTIVE', endsAt: { gt: now } },
      orderBy: { endsAt: 'asc' },
      select: { id: true, title: true, description: true, startsAt: true, endsAt: true },
    })
    const voted = new Set(
      (
        await db.participation.findMany({
          where: { voterId, electionId: { in: elections.map((e) => e.id) } },
          select: { electionId: true },
        })
      ).map((p) => p.electionId),
    )
    res.json(elections.map((e) => ({ ...e, hasVoted: voted.has(e.id), open: e.startsAt <= now })))
  })

  // Elections whose results have been published, newest first.
  router.get('/published', async (_req, res) => {
    res.json(
      await db.election.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { endsAt: 'desc' },
        select: { id: true, title: true, endsAt: true },
      }),
    )
  })

  // UC-04: the ballot.
  router.get('/:id/candidates', async (req, res) => {
    const { id } = parse(idSchema, req.params)
    const election = await db.election.findUnique({
      where: { id },
      include: {
        candidates: {
          orderBy: { name: 'asc' },
          select: { id: true, name: true, party: true, symbolUrl: true },
        },
      },
    })
    if (!election || election.status === 'DRAFT') {
      throw new ApiError(404, 'NOT_FOUND', 'Election not found')
    }
    const { candidates, ...rest } = election
    res.json({
      election: {
        id: rest.id,
        title: rest.title,
        status: rest.status,
        startsAt: rest.startsAt,
        endsAt: rest.endsAt,
      },
      candidates,
    })
  })

  // UC-06 View Results — only after an admin has published them.
  router.get('/:id/results', async (req, res) => {
    const { id } = parse(idSchema, req.params)
    const election = await db.election.findUnique({ where: { id } })
    if (!election || election.status === 'DRAFT')
      throw new ApiError(404, 'NOT_FOUND', 'Election not found')
    if (election.status !== 'PUBLISHED') {
      throw new ApiError(403, 'RESULTS_NOT_PUBLISHED', 'Results have not been published yet')
    }
    const { consistent: _internal, ...results } = await getResults(db, id)
    res.json({
      election: { id: election.id, title: election.title, endsAt: election.endsAt },
      turnout: await getTurnout(db, id, election.eligibleAtClose),
      ...results,
    })
  })

  // UC-05: cast a vote.
  router.post('/:id/vote', async (req, res) => {
    const { id: electionId } = parse(idSchema, req.params)
    const { candidateId } = parse(voteSchema, req.body)
    const voterId = authOf(req).sub

    const voter = await db.voter.findUnique({ where: { id: voterId }, select: { status: true } })
    if (voter?.status !== 'APPROVED') {
      throw new ApiError(403, 'ACCOUNT_NOT_ACTIVE', 'Your account cannot vote right now')
    }

    try {
      await db.$transaction(async (tx) => {
        // Shared lock: a concurrent close (which takes FOR UPDATE) waits for in-flight votes, and
        // a vote can't land after the close commits.
        const [election] = await tx.$queryRaw<{ status: string; startsAt: Date; endsAt: Date }[]>`
          SELECT status, startsAt, endsAt FROM Election WHERE id = ${electionId} LOCK IN SHARE MODE`
        if (!election || !isAcceptingVotes(election as never, new Date())) {
          throw new ApiError(409, 'ELECTION_NOT_OPEN', 'This election is not accepting votes')
        }
        const candidate = await tx.candidate.findUnique({ where: { id: candidateId } })
        if (!candidate || candidate.electionId !== electionId) {
          throw new ApiError(400, 'INVALID_CANDIDATE', 'That candidate is not on this ballot')
        }
        // Participation first: its primary key (voterId, electionId) is what enforces one vote
        // per person. A second attempt fails here and the whole transaction rolls back.
        await tx.participation.create({ data: { voterId, electionId } })
        // No voter id, no timestamp, random (not sequential) id — see brief §5.1.
        await tx.ballot.create({ data: { id: randomUUID(), electionId, candidateId } })
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await db.fraudAlert.create({
          data: {
            voterId,
            electionId,
            type: 'REPEAT_VOTE_ATTEMPT',
            severity: 'MEDIUM',
            description: 'A voter tried to vote again in an election they already voted in',
            details: { ip: req.ip ?? null },
          },
        })
        throw new ApiError(409, 'ALREADY_VOTED', 'You have already voted in this election')
      }
      throw err
    }

    // Deliberately no candidate in the response: the receipt must not prove how someone voted.
    res.status(201).json({ recorded: true })
  })

  return router
}
