import { describe, expect, test } from 'vitest'
import type { ElectionStatus } from '../../generated/prisma/client.js'
import { ACTIONS, decideTransition, isAcceptingVotes, isEditable } from './lifecycle.js'

const NOW = new Date('2026-11-01T10:00:00Z')
const HOUR = 3_600_000
const election = (
  status: ElectionStatus,
  over: Partial<{ endsAt: Date; candidateCount: number }> = {},
) => ({
  status,
  startsAt: new Date(NOW.getTime() + HOUR),
  endsAt: new Date(NOW.getTime() + 5 * HOUR),
  candidateCount: 3,
  ...over,
})

const STATUSES: ElectionStatus[] = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'PUBLISHED']
const VALID: Record<string, ElectionStatus> = {
  'DRAFT:schedule': 'SCHEDULED',
  'SCHEDULED:open': 'ACTIVE',
  'ACTIVE:close': 'CLOSED',
  'CLOSED:publish': 'PUBLISHED',
}

describe('every status × action combination', () => {
  const cases = STATUSES.flatMap((s) => ACTIONS.map((a) => [s, a] as const))
  test.each(cases)('%s + %s', (status, action) => {
    const result = decideTransition(election(status), action, NOW)
    const expected = VALID[`${status}:${action}`]
    if (expected) expect(result).toEqual({ ok: true, to: expected })
    else expect(result).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' })
  })

  test('covers all 20 combinations, exactly 4 valid', () => {
    expect(cases).toHaveLength(20)
    expect(cases.filter(([s, a]) => decideTransition(election(s), a, NOW).ok)).toHaveLength(4)
  })
})

describe('guards', () => {
  test.each([0, 1])('scheduling with %i candidate(s) is refused', (candidateCount) => {
    expect(decideTransition(election('DRAFT', { candidateCount }), 'schedule', NOW)).toMatchObject({
      ok: false,
      code: 'NOT_ENOUGH_CANDIDATES',
    })
  })

  test.each(['schedule', 'open'] as const)('%s after the end time is refused', (action) => {
    const status = action === 'schedule' ? 'DRAFT' : 'SCHEDULED'
    const ended = election(status, { endsAt: new Date(NOW.getTime() - 1) })
    expect(decideTransition(ended, action, NOW)).toMatchObject({
      ok: false,
      code: 'ELECTION_ENDED',
    })
  })

  test('closing early is allowed', () => {
    expect(decideTransition(election('ACTIVE'), 'close', NOW)).toEqual({ ok: true, to: 'CLOSED' })
  })
})

test('only DRAFT and SCHEDULED elections are editable', () => {
  expect(STATUSES.filter(isEditable)).toEqual(['DRAFT', 'SCHEDULED'])
})

describe('isAcceptingVotes', () => {
  const window = {
    startsAt: new Date(NOW.getTime() - HOUR),
    endsAt: new Date(NOW.getTime() + HOUR),
  }
  test('ACTIVE inside the window', () => {
    expect(isAcceptingVotes({ status: 'ACTIVE', ...window }, NOW)).toBe(true)
  })
  test.each(STATUSES.filter((s) => s !== 'ACTIVE'))('%s never accepts votes', (status) => {
    expect(isAcceptingVotes({ status, ...window }, NOW)).toBe(false)
  })
  test('ACTIVE but before start or at/after end', () => {
    expect(
      isAcceptingVotes({ status: 'ACTIVE', ...window }, new Date(window.startsAt.getTime() - 1)),
    ).toBe(false)
    expect(isAcceptingVotes({ status: 'ACTIVE', ...window }, window.endsAt)).toBe(false)
  })
})
