import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { VoterAuthProvider } from '../auth/VoterAuth.tsx'
import LoginPage from './LoginPage.tsx'

vi.mock('../components/FaceCapture.tsx', () => ({
  default: ({ onCapture }: { onCapture: (f: string[]) => void }) => (
    <button type="button" onClick={() => onCapture(['f1'])}>
      fake capture
    </button>
  ),
}))

const webauthn = vi.hoisted(() => ({
  startRegistration: vi.fn(async () => ({ id: 'new-cred' })),
  startAuthentication: vi.fn(async () => ({ id: 'cred' })),
}))
vi.mock('@simplewebauthn/browser', () => webauthn)

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function setup(next: 'WEBAUTHN_ENROL' | 'WEBAUTHN_LOGIN') {
  const routes: Record<string, () => Response> = {
    '/api/auth/refresh': () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    '/api/auth/voter/challenge': () => json(200, { challengeToken: 'tok', actions: ['BLINK'] }),
    '/api/auth/voter/face': () => json(200, { faceToken: 'ft', next, recoveryPending: false }),
    '/api/voters/me/webauthn/register/options': () => json(200, { challenge: 'reg' }),
    '/api/voters/me/webauthn/register/verify': () => json(201, { accessToken: 'at' }),
    '/api/auth/voter/webauthn/options': () => json(200, { challenge: 'auth' }),
    '/api/auth/voter/webauthn/verify': () => json(200, { accessToken: 'at' }),
    '/api/auth/voter/recovery': () => json(202, { status: 'PENDING' }),
    '/api/me': () => json(200, { id: 'v1', name: 'Aisha', email: 'a@x.io', status: 'APPROVED' }),
  }
  const fetchMock = vi.fn(
    async (url: string, _init?: RequestInit) => routes[url]?.() ?? json(404, {}),
  )
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter initialEntries={['/login']}>
      <VoterAuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/voter" element={<p>voter home</p>} />
        </Routes>
      </VoterAuthProvider>
    </MemoryRouter>,
  )
  return fetchMock
}

async function passFaceStep() {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('CNIC number'), '3520212345671')
  await user.click(screen.getByRole('button', { name: 'Continue to face check' }))
  await user.click(await screen.findByRole('button', { name: 'fake capture' }))
  await screen.findByText('Face verified.')
  return user
}

test('first sign-in enrols this device, then lands on the voter page', async () => {
  const fetchMock = setup('WEBAUTHN_ENROL')
  const user = await passFaceStep()
  await user.click(screen.getByRole('button', { name: 'Set up this device' }))
  expect(await screen.findByText('voter home')).toBeInTheDocument()
  expect(webauthn.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'reg' } })
  const verify = fetchMock.mock.calls.find(
    ([u]) => u === '/api/voters/me/webauthn/register/verify',
  )!
  expect(JSON.parse(String(verify[1]?.body))).toEqual({
    faceToken: 'ft',
    response: { id: 'new-cred' },
  })
})

test('returning voter confirms with fingerprint', async () => {
  setup('WEBAUTHN_LOGIN')
  const user = await passFaceStep()
  await user.click(screen.getByRole('button', { name: 'Use fingerprint' }))
  expect(await screen.findByText('voter home')).toBeInTheDocument()
  expect(webauthn.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'auth' } })
})

test('cancelling the fingerprint prompt shows the reason and allows retry', async () => {
  setup('WEBAUTHN_LOGIN')
  webauthn.startAuthentication.mockRejectedValueOnce(new Error('The operation was cancelled.'))
  const user = await passFaceStep()
  await user.click(screen.getByRole('button', { name: 'Use fingerprint' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('cancelled')
  expect(screen.getByRole('button', { name: 'Use fingerprint' })).toBeEnabled()
})

test('lost device: request recovery', async () => {
  const fetchMock = setup('WEBAUTHN_LOGIN')
  const user = await passFaceStep()
  await user.click(screen.getByRole('button', { name: 'Lost the device you registered with?' }))
  expect(await screen.findByText('Request sent.')).toBeInTheDocument()
  expect(fetchMock.mock.calls.some(([u]) => u === '/api/auth/voter/recovery')).toBe(true)
})
