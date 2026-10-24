import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ElectionOutcome from './ElectionOutcome.tsx'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

const results = (consistent: boolean) => ({
  turnout: { voted: 3, eligible: 4, percent: 75 },
  totalVotes: 3,
  consistent,
  results: [
    { candidateId: 'c2', name: 'Zainab', party: 'Green', votes: 2, percent: 66.7 },
    { candidateId: 'c1', name: 'Aisha', party: 'Blue', votes: 1, percent: 33.3 },
  ],
})

test('ACTIVE: shows live turnout and never asks for per-candidate results', async () => {
  const fetchMock = vi.fn(async (_url: string) => json(200, { voted: 3, eligible: 4, percent: 75 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<ElectionOutcome id="e1" status="ACTIVE" />)
  expect(await screen.findByText('75%')).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'Turnout' })).toHaveAttribute(
    'aria-valuenow',
    '75',
  )
  expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(['/api/admin/elections/e1/turnout'])
})

test('CLOSED: shows the tally as a table and asks to publish', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(200, results(true))),
  )
  render(<ElectionOutcome id="e1" status="CLOSED" />)
  const rows = await screen.findAllByRole('row')
  expect(rows.map((r) => r.textContent)).toEqual([
    'CandidatePartyVotesShare',
    'ZainabGreen266.7%',
    'AishaBlue133.3%',
  ])
  expect(screen.getByText(/once you publish them/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('an inconsistent tally shows an integrity warning', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(200, results(false))),
  )
  render(<ElectionOutcome id="e1" status="PUBLISHED" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Integrity warning')
})

test('DRAFT: nothing to show, nothing fetched', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const { container } = render(<ElectionOutcome id="e1" status="DRAFT" />)
  expect(container).toBeEmptyDOMElement()
  expect(fetchMock).not.toHaveBeenCalled()
})
