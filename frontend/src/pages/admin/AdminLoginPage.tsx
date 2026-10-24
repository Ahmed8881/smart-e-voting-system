import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useAdminAuth } from '../../auth/AdminAuth.tsx'
import { Button, ErrorText, Field } from '../../components/ui.tsx'
import { errorMessage } from '../../lib/api.ts'

export default function AdminLoginPage() {
  const { admin, login, verifyOtp } = useAdminAuth()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/admin'
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (admin) return <Navigate to={from} replace />

  async function run(action: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    void run(async () => {
      setChallengeId(await login(String(form.get('email')), String(form.get('password'))))
    })
  }

  function onOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const code = String(new FormData(e.currentTarget).get('code'))
    void run(async () => {
      await verifyOtp(challengeId!, code)
      navigate(from, { replace: true })
    })
  }

  return (
    <main className="mx-auto mt-16 max-w-sm px-4">
      <h1 className="mb-6 text-2xl font-semibold">Admin sign in</h1>
      {challengeId === null ? (
        <form key="password" onSubmit={onPassword} className="space-y-4">
          <Field label="Email" name="email" type="email" autoComplete="username" required />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} className="w-full">
            Continue
          </Button>
        </form>
      ) : (
        <form key="otp" onSubmit={onOtp} className="space-y-4">
          <p className="text-sm text-gray-700">
            We emailed you a 6-digit code. It expires in 5 minutes.
          </p>
          <Field
            label="Login code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
          />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} className="w-full">
            Sign in
          </Button>
          <button
            type="button"
            className="w-full text-sm text-gray-600 underline"
            onClick={() => {
              setChallengeId(null)
              setError('')
            }}
          >
            Start again
          </button>
        </form>
      )}
    </main>
  )
}
