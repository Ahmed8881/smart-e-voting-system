import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import BallotPage from './BallotPage.tsx'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

const ballot = {
  election: { id: 'e1', title: 'Council President', endsAt: '2026-11-01T17:00:00Z' },
  candidates: [
    { id: 'c1', name: 'Aisha', party: 'Blue', symbolUrl: null },
    { id: 'c2', name: 'Zainab', party: 'Green', symbolUrl: null },
  ],
}

function renderBallot(voteResponse: () => Response) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? voteResponse() : json(200, ballot),
  )
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter initialEntries={['/voter/elections/e1']}>
      <Routes>
        <Route path="/voter/elections/:id" element={<BallotPage />} />
      </Routes>
    </MemoryRouter>,
  )
  return fetchMock
}

test('choose → confirm → cast; the confirmation names the candidate, the receipt does not', async () => {
  const fetchMock = renderBallot(() => json(201, { recorded: true }))
  const user = userEvent.setup()
  await user.click(await screen.findByRole('radio', { name: /Zainab/ }))
  await user.click(screen.getByRole('button', { name: 'Review my vote' }))

  expect(screen.getByText('You are voting for').parentElement).toHaveTextContent('Zainab')
  expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0)

  await user.click(screen.getByRole('button', { name: 'Confirm and cast vote' }))
  expect(await screen.findByText('Your vote has been recorded.')).toBeInTheDocument()
  expect(screen.queryByText('Zainab')).not.toBeInTheDocument()
  const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
  expect(url).toBe('/api/elections/e1/vote')
  expect(JSON.parse(String(init?.body))).toEqual({ candidateId: 'c2' })
})

test('reviewing without choosing asks for a choice', async () => {
  renderBallot(() => json(201, {}))
  await userEvent.click(await screen.findByRole('button', { name: 'Review my vote' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a candidate first.')
})

test('the voter can go back and change their choice before confirming', async () => {
  renderBallot(() => json(201, {}))
  const user = userEvent.setup()
  await user.click(await screen.findByRole('radio', { name: /Aisha/ }))
  await user.click(screen.getByRole('button', { name: 'Review my vote' }))
  await user.click(screen.getByRole('button', { name: 'Change my choice' }))
  expect(screen.getByRole('radio', { name: /Aisha/ })).toBeChecked()
})

test('already voted → the server message is shown', async () => {
  renderBallot(() =>
    json(409, {
      error: { code: 'ALREADY_VOTED', message: 'You have already voted in this election' },
    }),
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('radio', { name: /Aisha/ }))
  await user.click(screen.getByRole('button', { name: 'Review my vote' }))
  await user.click(screen.getByRole('button', { name: 'Confirm and cast vote' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('already voted')
})
