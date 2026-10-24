import type { Db } from '../../db.js'
import type { Prisma } from '../../generated/prisma/client.js'

/**
 * UC-13 Generate Results. Runs inside the close transaction, which holds the election row
 * FOR UPDATE — every vote that started earlier has committed and no new one can, so the tally
 * is complete. Also checks ballots == participations; a mismatch means the data was tampered with.
 */
export async function computeTally(tx: Prisma.TransactionClient, electionId: string) {
  const [candidates, counts, participations, eligible] = await Promise.all([
    tx.candidate.findMany({ where: { electionId }, select: { id: true } }),
    tx.ballot.groupBy({ by: ['candidateId'], where: { electionId }, _count: { _all: true } }),
    tx.participation.count({ where: { electionId } }),
    tx.voter.count({ where: { status: 'APPROVED' } }),
  ])
  const votes = new Map(counts.map((c) => [c.candidateId, c._count._all]))
  const computedAt = new Date()
  await tx.resultTally.createMany({
    data: candidates.map((c) => ({
      electionId,
      candidateId: c.id,
      voteCount: votes.get(c.id) ?? 0,
      computedAt,
    })),
  })
  await tx.election.update({ where: { id: electionId }, data: { eligibleAtClose: eligible } })

  const ballots = counts.reduce((sum, c) => sum + c._count._all, 0)
  if (ballots !== participations) {
    await tx.fraudAlert.create({
      data: {
        electionId,
        type: 'TALLY_MISMATCH',
        severity: 'HIGH',
        description: 'Number of ballots does not match number of voters who participated',
        details: { ballots, participations },
      },
    })
  }
  return { ballots, participations, eligible }
}

/** Live turnout — counts only, never per-candidate (brief §5.7). */
export async function getTurnout(db: Db, electionId: string, eligibleAtClose: number | null) {
  const [voted, eligibleNow] = await Promise.all([
    db.participation.count({ where: { electionId } }),
    eligibleAtClose === null ? db.voter.count({ where: { status: 'APPROVED' } }) : eligibleAtClose,
  ])
  return {
    voted,
    eligible: eligibleNow,
    percent: eligibleNow ? Math.round((voted / eligibleNow) * 1000) / 10 : 0,
  }
}

/** The stored tally, joined with candidate details, highest first. */
export async function getResults(db: Db, electionId: string) {
  const [tallies, participations] = await Promise.all([
    db.resultTally.findMany({
      where: { electionId },
      include: { candidate: { select: { name: true, party: true, symbolUrl: true } } },
      orderBy: [{ voteCount: 'desc' }, { candidate: { name: 'asc' } }],
    }),
    db.participation.count({ where: { electionId } }),
  ])
  const totalVotes = tallies.reduce((sum, t) => sum + t.voteCount, 0)
  return {
    totalVotes,
    // Recomputed on every read: if ballots or participations are edited after close, it shows.
    consistent: totalVotes === participations,
    computedAt: tallies[0]?.computedAt ?? null,
    results: tallies.map((t) => ({
      candidateId: t.candidateId,
      name: t.candidate.name,
      party: t.candidate.party,
      symbolUrl: t.candidate.symbolUrl,
      votes: t.voteCount,
      percent: totalVotes ? Math.round((t.voteCount / totalVotes) * 1000) / 10 : 0,
    })),
  }
}
