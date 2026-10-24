import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { api, post, refreshSession, setAccessToken } from '../lib/api.ts'

export type Admin = { id: string; name: string; email: string }

type AdminAuth = {
  admin: Admin | null
  loading: boolean
  /** Step 1: returns the OTP challenge id. */
  login: (email: string, password: string) => Promise<string>
  /** Step 2: completes login. */
  verifyOtp: (challengeId: string, code: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AdminAuth | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null)
  const [loading, setLoading] = useState(true)

  // Restore the session after a page reload using the refresh cookie.
  useEffect(() => {
    refreshSession()
      .then((role) => (role === 'ADMIN' ? api<Admin>('/admin/me') : null))
      .then(setAdmin)
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false))
  }, [])

  const value: AdminAuth = {
    admin,
    loading,
    async login(email, password) {
      const res = await post<{ challengeId: string }>('/auth/admin/login', { email, password })
      return res.challengeId
    },
    async verifyOtp(challengeId, code) {
      const res = await post<{ accessToken: string; admin: Admin }>('/auth/admin/otp', {
        challengeId,
        code,
      })
      setAccessToken(res.accessToken)
      setAdmin(res.admin)
    },
    async logout() {
      await post('/auth/logout').catch(() => undefined)
      setAccessToken(null)
      setAdmin(null)
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAdminAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAdminAuth must be used inside AdminAuthProvider')
  return ctx
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { admin, loading } = useAdminAuth()
  const location = useLocation()
  if (loading) return <p className="p-6 text-gray-600">Loading…</p>
  if (!admin) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  return children
}
