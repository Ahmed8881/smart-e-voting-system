import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../../app.js'
import { ApiError } from '../../errors.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { authOf } from '../../middleware/auth.js'
import { parse } from '../../lib/validate.js'
import { appendAudit } from '../audit/audit.service.js'
import { computeTally, getResults, getTurnout } from '../results/results.service.js'
import { ACTIONS, decideTransition, isEditable } from './lifecycle.js'

const isoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v))

const electionFields = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).default(''),
  startsAt: isoDate,
  endsAt: isoDate,
})
const endsAfterStarts = (e: { startsAt?: Date; endsAt?: Date }) =>
  !e.startsAt || !e.endsAt || e.endsAt > e.startsAt
const createSchema = electionFields.refine(endsAfterStarts, {
  message: 'must be after startsAt',
  path: ['endsAt'],
})
const updateSchema = electionFields.partial().refine(endsAfterStarts, {
  message: 'must be after startsAt',
  path: ['endsAt'],
})

const candidateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  party: z.string().trim().min(1).max(120),
  symbolUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullish(),
})

const idSchema = z.object({ id: z.uuid() })
const candidateIdSchema = z.object({ id: z.uuid(), candidateId: z.uuid() })

/** Mounted under /api/admin/elections (role ADMIN). UC-08 Manage Elections, UC-09 Manage Candidates. */
export function adminElectionsRouter({ db }: Deps) {
  const router = Router()

  router.get('/', async (_req, res) => {
    const elections = await db.election.findMany({
      orderBy: { startsAt: 'desc' },
      include: { _count: { select: { candidates: true } } },
    })
    res.json(elections.map(({ _count, ...e }) => ({ ...e, candidateCount: _count.candidates })))
  })

  router.post('/', async (req, res) => {
    const input = parse(createSchema, req.body)
    const adminId = authOf(req).sub
    const election = await db.$transaction(async (tx) => {
      const created = await tx.election.create({ data: { ...input, createdById: adminId } })
      await audit(tx, adminId, 'ELECTION_CREATED', { electionId: created.id, title: created.title })
      return created
    })
    res.status(201).json(election)
  })

  router.get('/:id', async (req, res) => {
    const { id } = parse(idSchema, req.params)
    const election = await db.election.findUnique({
      where: { id },
      include: { candidates: { orderBy: { name: 'asc' } } },
    })
    if (!election) throw notFound()
    res.json(election)
  })

  router.patch('/:id', async (req, res) => {
    const { id } = parse(idSchema, req.params)
    const input = parse(updateSchema, req.body)
    const adminId = authOf(req).sub
    const updated = await db.$transaction(async (tx) => {
      const election = await lockElection(tx, id)
      assertEditable(election.status)
      const merged = { startsAt: election.startsAt, endsAt: election.endsAt, ...input }
      if (merged.endsAt <= merged.startsAt) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'endsAt: must be after startsAt')
      }
      const result = await tx.election.update({ where: { id }, data: input })
      await audit(tx, adminId, 'ELECTION_UPDATED', { electionId: id, changes: input })
      return result
    })
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const { id } = parse(idSchema, req.params)
    const adminId = authOf(req).sub
    await db.$transaction(async (tx) => {
      const election = await lockElection(tx, id)
      if (election.status !== 'DRAFT') {
        throw new ApiError(409, 'ELECTION_LOCKED', 'Only DRAFT elections can be deleted')
      }
      await tx.election.delete({ where: { id } }) // candidates cascade
      await audit(tx, adminId, 'ELECTION_DELETED', { electionId: id, title: election.title })
    })
    res.status(204).end()
  })

  for (const action of ACTIONS) {
    router.post(`/:id/${action}`, async (req, res) => {
      const { id } = parse(idSchema, req.params)
      const adminId = authOf(req).sub
      const updated = await db.$transaction(async (tx) => {
        const election = await lockElection(tx, id)
        const candidateCount = await tx.candidate.count({ where: { electionId: id } })
        const decision = decideTransition({ ...election, candidateCount }, action, new Date())
        if (!decision.ok) throw new ApiError(409, decision.code, decision.message)
        const result = await tx.election.update({ where: { id }, data: { status: decision.to } })
        if (decision.to === 'CLOSED') await computeTally(tx, id)
        await audit(tx, adminId, `ELECTION_${decision.to}`, {
          electionId: id,
          from: election.status,
          to: decision.to,
        })
        return result
      })
      res.json(updated)
    })
  }

  // Live turnout: allowed at any time, because it reveals no choices.
  router.get('/:id/turnout', async (req, res) => {
    const { id } = parse(idSchema, req.params)
    const election = await db.election.findUnique({ where: { id } })
    if (!election) throw notFound()
    res.json(await getTurnout(db, id, election.eligibleAtClose))
  })

  // Per-candidate results only once voting has closed — admins can check them before publishing.
  router.get('/:id/results', async (req, res) => {
    const { id } = parse(idSchema, req.params)
    const election = await db.election.findUnique({ where: { id } })
    if (!election) throw notFound()
    if (election.status !== 'CLOSED' && election.status !== 'PUBLISHED') {
      throw new ApiError(409, 'RESULTS_HIDDEN', 'Results are hidden until voting closes')
    }
    res.json({
      status: election.status,
      turnout: await getTurnout(db, id, election.eligibleAtClose),
      ...(await getResults(db, id)),
    })
  })

  // Candidates — only while the election is DRAFT or SCHEDULED.
  router.post('/:id/candidates', async (req, res) => {
    const { id } = parse(idSchema, req.params)
    const input = parse(candidateSchema, req.body)
    const adminId = authOf(req).sub
    const candidate = await db.$transaction(async (tx) => {
      assertEditable((await lockElection(tx, id)).status)
      const created = await tx.candidate.create({
        data: {
          ...input,
          symbolUrl: input.symbolUrl ?? null,
          electionId: id,
          createdById: adminId,
        },
      })
      await audit(tx, adminId, 'CANDIDATE_ADDED', {
        electionId: id,
        candidateId: created.id,
        name: created.name,
      })
      return created
    })
    res.status(201).json(candidate)
  })

  router.patch('/:id/candidates/:candidateId', async (req, res) => {
    const { id, candidateId } = parse(candidateIdSchema, req.params)
    const input = parse(candidateSchema.partial(), req.body)
    const adminId = authOf(req).sub
    const candidate = await db.$transaction(async (tx) => {
      assertEditable((await lockElection(tx, id)).status)
      await findCandidate(tx, id, candidateId)
      const updated = await tx.candidate.update({ where: { id: candidateId }, data: input })
      await audit(tx, adminId, 'CANDIDATE_UPDATED', { electionId: id, candidateId, changes: input })
      return updated
    })
    res.json(candidate)
  })

  router.delete('/:id/candidates/:candidateId', async (req, res) => {
    const { id, candidateId } = parse(candidateIdSchema, req.params)
    const adminId = authOf(req).sub
    await db.$transaction(async (tx) => {
      assertEditable((await lockElection(tx, id)).status)
      const candidate = await findCandidate(tx, id, candidateId)
      await tx.candidate.delete({ where: { id: candidateId } })
      await audit(tx, adminId, 'CANDIDATE_REMOVED', {
        electionId: id,
        candidateId,
        name: candidate.name,
      })
    })
    res.status(204).end()
  })

  return router
}

/**
 * Reads the election FOR UPDATE, serialising every change to it — so a candidate can't be added
 * in the same instant the election is opened.
 */
async function lockElection(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM Election WHERE id = ${id} FOR UPDATE`
  if (rows.length === 0) throw notFound()
  return tx.election.findUniqueOrThrow({ where: { id } })
}

async function findCandidate(
  tx: Prisma.TransactionClient,
  electionId: string,
  candidateId: string,
) {
  const candidate = await tx.candidate.findUnique({ where: { id: candidateId } })
  if (!candidate || candidate.electionId !== electionId) {
    throw new ApiError(404, 'NOT_FOUND', 'Candidate not found')
  }
  return candidate
}

function assertEditable(status: Parameters<typeof isEditable>[0]) {
  if (!isEditable(status)) {
    throw new ApiError(
      409,
      'ELECTION_LOCKED',
      `The election is ${status}; it can no longer be changed`,
    )
  }
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Election not found')

function audit(
  tx: Prisma.TransactionClient,
  adminId: string,
  action: string,
  payload: Record<string, unknown>,
) {
  return appendAudit(tx, { actorType: 'ADMIN', actorId: adminId, action, payload })
}
