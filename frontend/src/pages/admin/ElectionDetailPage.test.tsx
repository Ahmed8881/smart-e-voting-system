import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import ElectionDetailPage from './ElectionDetailPage.tsx'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

const election = (status: string) => ({
  id: 'e1',
  title: 'Council President',
  description: '',
  status,
  startsAt: '2026-11-01T09:00:00Z',
  endsAt: '2026-11-01T17:00:00Z',
  candidates: [{ id: 'c1', name: 'Aisha', party: 'Blue', symbolUrl: null }],
})

function renderPage(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter initialEntries={['/admin/elections/e1']}>
      <Routes>
        <Route path="/admin/elections/:id" element={<ElectionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('DRAFT: candidates can be added', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? json(201, {}) : json(200, election('DRAFT')),
  )
  renderPage(fetchMock)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Name'), 'Zainab')
  await user.type(screen.getByLabelText('Party'), 'Green')
  await user.click(screen.getByRole('button', { name: 'Add candidate' }))
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(call[0]).toBe('/api/admin/elections/e1/candidates')
  expect(JSON.parse(String(call[1]?.body))).toEqual({
    name: 'Zainab',
    party: 'Green',
    symbolUrl: null,
  })
})

test('ACTIVE: candidates are shown as locked and the next action is closing', async () => {
  renderPage(vi.fn(async () => json(200, election('ACTIVE'))))
  expect(await screen.findByText(/candidates are locked/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add candidate' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove Aisha' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Close voting' })).toBeInTheDocument()
})

test('a refused transition shows the server reason', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderPage(
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? json(409, {
            error: {
              code: 'NOT_ENOUGH_CANDIDATES',
              message: 'An election needs at least 2 candidates',
            },
          })
        : json(200, election('DRAFT')),
    ),
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('at least 2 candidates')
})
