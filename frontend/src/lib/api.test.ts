import { afterEach, expect, test, vi } from 'vitest'
import { ApiError, api, setAccessToken } from './api.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

test('sends the access token and returns the JSON body', async () => {
  const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: 1 }))
  vi.stubGlobal('fetch', fetchMock)
  setAccessToken('t1')
  expect(await api('/x')).toEqual({ ok: 1 })
  const [url, init] = fetchMock.mock.calls[0]!
  expect(url).toBe('/api/x')
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer t1')
})

test('on 401 refreshes once and retries with the new token', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } }))
    .mockResolvedValueOnce(json(200, { accessToken: 't2', role: 'ADMIN' }))
    .mockResolvedValueOnce(json(200, { ok: 2 }))
  vi.stubGlobal('fetch', fetchMock)
  setAccessToken('t1')
  expect(await api('/x')).toEqual({ ok: 2 })
  expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/refresh')
  expect(new Headers(fetchMock.mock.calls[2]![1].headers).get('Authorization')).toBe('Bearer t2')
})

test('throws ApiError with the backend code and message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(json(400, { error: { code: 'VALIDATION_ERROR', message: 'bad' } })),
  )
  await expect(api('/x')).rejects.toEqual(new ApiError(400, 'VALIDATION_ERROR', 'bad'))
})
