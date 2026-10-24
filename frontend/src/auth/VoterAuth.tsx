import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { api, post, refreshSession, setAccessToken } from '../lib/api.ts'

export type Voter = { id: string; name: string; email: string; status: string }

type VoterAuth = {
  voter: Voter | null
  loading: boolean
  /** Called after the WebAuthn step returns tokens. */
  signedIn: (accessToken: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<VoterAuth | null>(null)

export function VoterAuthProvider({ children }: { children: ReactNode }) {
  const [voter, setVoter] = useState<Voter | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    refreshSession()
      .then((role) => (role === 'VOTER' ? api<Voter>('/me') : null))
      .then(setVoter)
      .catch(() => setVoter(null))
      .finally(() => setLoading(false))
  }, [])

  const value: VoterAuth = {
    voter,
    loading,
    async signedIn(accessToken) {
      setAccessToken(accessToken)
      setVoter(await api<Voter>('/me'))
    },
    async logout() {
      await post('/auth/logout').catch(() => undefined)
      setAccessToken(null)
      setVoter(null)
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useVoterAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useVoterAuth must be used inside VoterAuthProvider')
  return ctx
}

export function RequireVoter({ children }: { children: ReactNode }) {
  const { voter, loading } = useVoterAuth()
  if (loading) return <p className="p-6 text-gray-600">Loading…</p>
  if (!voter) return <Navigate to="/login" replace />
  return children
}
