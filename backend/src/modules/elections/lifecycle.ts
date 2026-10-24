import type { ElectionStatus } from '../../generated/prisma/client.js'

/** Election lifecycle (brief §5.10): DRAFT → SCHEDULED → ACTIVE → CLOSED → PUBLISHED. */
export const ACTIONS = ['schedule', 'open', 'close', 'publish'] as const
export type LifecycleAction = (typeof ACTIONS)[number]

const RULES: Record<LifecycleAction, { from: ElectionStatus; to: ElectionStatus }> = {
  schedule: { from: 'DRAFT', to: 'SCHEDULED' },
  open: { from: 'SCHEDULED', to: 'ACTIVE' },
  close: { from: 'ACTIVE', to: 'CLOSED' },
  publish: { from: 'CLOSED', to: 'PUBLISHED' },
}

export const MIN_CANDIDATES = 2

type ElectionFacts = {
  status: ElectionStatus
  startsAt: Date
  endsAt: Date
  candidateCount: number
}

export type TransitionResult =
  { ok: true; to: ElectionStatus } | { ok: false; code: string; message: string }

/** Pure decision: may this action be taken now? No I/O, so every case is unit-tested. */
export function decideTransition(
  election: ElectionFacts,
  action: LifecycleAction,
  now: Date,
): TransitionResult {
  const rule = RULES[action]
  if (election.status !== rule.from) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Cannot ${action} an election that is ${election.status} (must be ${rule.from})`,
    }
  }
  if (action === 'schedule') {
    if (election.candidateCount < MIN_CANDIDATES) {
      return {
        ok: false,
        code: 'NOT_ENOUGH_CANDIDATES',
        message: `An election needs at least ${MIN_CANDIDATES} candidates`,
      }
    }
    if (election.endsAt <= now) {
      return { ok: false, code: 'ELECTION_ENDED', message: 'The voting period has already ended' }
    }
  }
  if (action === 'open' && election.endsAt <= now) {
    return { ok: false, code: 'ELECTION_ENDED', message: 'The voting period has already ended' }
  }
  return { ok: true, to: rule.to }
}

/** Candidates and election details can change only before voting starts (brief §5.9). */
export const isEditable = (status: ElectionStatus) => status === 'DRAFT' || status === 'SCHEDULED'

/** Votes are accepted only while ACTIVE and inside the voting window. */
export const isAcceptingVotes = (
  election: { status: ElectionStatus; startsAt: Date; endsAt: Date },
  now: Date,
) => election.status === 'ACTIVE' && election.startsAt <= now && now < election.endsAt
