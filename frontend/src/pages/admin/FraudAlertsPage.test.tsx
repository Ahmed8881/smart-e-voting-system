import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import FraudAlertsPage from './FraudAlertsPage.tsx'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

const alert = {
  id: 'a1',
  type: 'REPEATED_FAILED_LOGINS',
  severity: 'HIGH',
  status: 'OPEN',
  score: null,
  description: '5 failed sign-in attempts within the window',
  details: { failures: 5 },
  createdAt: '2026-10-24T10:00:00Z',
  voter: { id: 'v1', name: 'Aisha', cnic: '35202-1234567-1', status: 'LOCKED' },
  election: null,
}

test('shows open alerts with severity as text, links locked voters, and reviews', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH'
      ? json(200, {})
      : json(200, { items: [alert], total: 1, openBySeverity: { HIGH: 1 } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter>
      <FraudAlertsPage />
    </MemoryRouter>,
  )
  expect(await screen.findByText('REPEATED_FAILED_LOGINS')).toBeInTheDocument()
  expect(screen.getByLabelText('Open alerts by severity')).toHaveTextContent('1 open high')
  expect(screen.getByRole('link', { name: 'review in Voters to unlock' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Dismiss (false alarm)' }))
  const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!
  expect(patch[0]).toBe('/api/admin/fraud-alerts/a1')
  expect(JSON.parse(String(patch[1]?.body))).toEqual({ status: 'DISMISSED' })
})

test('changing the filter requests that status', async () => {
  const fetchMock = vi.fn(async (_url: string) =>
    json(200, { items: [], total: 0, openBySeverity: {} }),
  )
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter>
      <FraudAlertsPage />
    </MemoryRouter>,
  )
  await userEvent.selectOptions(await screen.findByRole('combobox'), 'Dismissed')
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/admin/fraud-alerts?status=DISMISSED')
})
