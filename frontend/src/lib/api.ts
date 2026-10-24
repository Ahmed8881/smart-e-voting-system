/** Error returned by the backend in its standard { error: { code, message } } shape. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Something went wrong'

// The access token lives only in memory; the refresh token is an httpOnly cookie the JS never sees.
let accessToken: string | null = null
export const setAccessToken = (token: string | null) => {
  accessToken = token
}

async function send(path: string, init: RequestInit) {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' })
}

/** Exchanges the refresh cookie for a new access token. Returns the role, or null if logged out. */
export async function refreshSession(): Promise<string | null> {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
  if (!res.ok) {
    setAccessToken(null)
    return null
  }
  const body = (await res.json()) as { accessToken: string; role: string }
  setAccessToken(body.accessToken)
  return body.role
}

/** JSON request to the backend. On an expired access token it refreshes once and retries. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init)
  if (res.status === 401 && accessToken && (await refreshSession())) {
    res = await send(path, init)
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'Request failed',
    )
  }
  return body as T
}

export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) })

export const put = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(data) })
