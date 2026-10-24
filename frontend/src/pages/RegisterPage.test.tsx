import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import RegisterPage from './RegisterPage.tsx'

// The camera can't run in jsdom; the capture component is replaced by a button that "captures".
vi.mock('../components/FaceCapture.tsx', () => ({
  default: ({ actions, onCapture }: { actions: string[]; onCapture: (f: string[]) => void }) => (
    <button type="button" onClick={() => onCapture(['f1', 'f2'])}>
      fake capture {actions.join(',')}
    </button>
  ),
}))

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

async function fillDetails(cnicDigits = '3520212345671') {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  )
  await user.type(screen.getByLabelText('Full name (as on CNIC)'), 'Aisha Ishfaq')
  await user.type(screen.getByLabelText('Email'), 'aisha@example.com')
  await user.type(screen.getByLabelText('CNIC number'), cnicDigits)
  return user
}

test('formats the CNIC, runs the face check and submits everything', async () => {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    url === '/api/voters/register/challenge'
      ? json(200, { challengeToken: 'tok', actions: ['BLINK', 'TURN_LEFT'] })
      : json(201, { id: 'v1', status: 'PENDING' }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const user = await fillDetails()
  expect(screen.getByLabelText('CNIC number')).toHaveValue('35202-1234567-1')

  await user.click(screen.getByRole('button', { name: 'Continue to face check' }))
  await user.click(await screen.findByRole('button', { name: 'fake capture BLINK,TURN_LEFT' }))

  expect(await screen.findByText('Registration submitted.')).toBeInTheDocument()
  const submit = fetchMock.mock.calls.find(([url]) => url === '/api/voters/register')!
  expect(JSON.parse(String(submit[1]?.body))).toEqual({
    name: 'Aisha Ishfaq',
    email: 'aisha@example.com',
    cnic: '35202-1234567-1',
    challengeToken: 'tok',
    frames: ['f1', 'f2'],
  })
})

test('an incomplete CNIC is caught before the camera starts', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const user = await fillDetails('35202123')
  await user.click(screen.getByRole('button', { name: 'Continue to face check' }))
  expect(screen.getByRole('alert')).toHaveTextContent('CNIC must be 13 digits')
  expect(fetchMock).not.toHaveBeenCalled()
})

test('a failed face check returns to the form with the reason', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/voters/register/challenge'
        ? json(200, { challengeToken: 'tok', actions: ['BLINK'] })
        : json(422, { error: { code: 'LIVENESS_FAILED', message: 'Please try again.' } }),
    ),
  )
  const user = await fillDetails()
  await user.click(screen.getByRole('button', { name: 'Continue to face check' }))
  await user.click(await screen.findByRole('button', { name: /fake capture/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.')
  expect(screen.getByLabelText('Email')).toHaveValue('aisha@example.com')
})
