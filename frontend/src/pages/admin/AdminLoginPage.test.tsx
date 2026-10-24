import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import App from '../../App.tsx'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

test('protected admin page redirects to login, then password + OTP signs in', async () => {
  const routes: Record<string, () => Response> = {
    '/api/auth/refresh': () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    '/api/auth/admin/login': () => json(200, { otpRequired: true, challengeId: 'c1' }),
    '/api/auth/admin/otp': () =>
      json(200, { accessToken: 't', admin: { id: '1', name: 'A', email: 'a@x.io' } }),
    '/api/admin/settings': () => json(200, { 'fraud.maxFailedLogins': 5 }),
  }
  const fetchMock = vi.fn(
    async (url: string, _init?: RequestInit) => routes[url]?.() ?? json(404, {}),
  )
  vi.stubGlobal('fetch', fetchMock)

  renderAt('/admin/settings')
  const user = userEvent.setup()

  await user.type(await screen.findByLabelText('Email'), 'a@x.io')
  await user.type(screen.getByLabelText('Password'), 'secret')
  await user.click(screen.getByRole('button', { name: 'Continue' }))

  await user.type(await screen.findByLabelText('Login code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByRole('heading', { name: 'System settings' })).toBeInTheDocument()
  const otpCall = fetchMock.mock.calls.find(([url]) => url === '/api/auth/admin/otp')!
  expect(JSON.parse(String(otpCall[1]?.body))).toEqual({
    challengeId: 'c1',
    code: '123456',
  })
})

test('shows the backend error message on wrong password', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/auth/admin/login'
        ? json(401, {
            error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
          })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    ),
  )
  renderAt('/admin/login')
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), 'a@x.io')
  await user.type(screen.getByLabelText('Password'), 'nope')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect')
})
