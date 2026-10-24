import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import VotersPage from './VotersPage.tsx'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

test('shows pending voters and approves one', async () => {
  let status = 'PENDING'
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      status = 'APPROVED'
      return json(200, { id: 'v1', status })
    }
    const items =
      url.includes('status=PENDING') && status !== 'PENDING'
        ? []
        : [
            {
              id: 'v1',
              name: 'Aisha',
              email: 'a@x.io',
              cnic: '35202-1234567-1',
              status,
              createdAt: '2026-10-24T00:00:00Z',
            },
          ]
    return json(200, { items, total: items.length })
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<VotersPage />)
  const row = (await screen.findByRole('cell', { name: 'Aisha' })).closest('tr')!
  await userEvent.click(within(row).getByRole('button', { name: 'Approve Aisha' }))

  expect(await screen.findByText('No voters found.')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/admin/voters/v1/approve',
    expect.objectContaining({ method: 'POST' }),
  )
})

test('changing the filter reloads with that status', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    json(200, { items: [], total: 0 }),
  )
  vi.stubGlobal('fetch', fetchMock)
  render(<VotersPage />)
  await userEvent.click(screen.getByRole('button', { name: 'Locked' }))
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/admin/voters?status=LOCKED')
})
