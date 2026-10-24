import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useVoterAuth } from '../auth/VoterAuth.tsx'
import FaceCapture, { type LivenessAction } from '../components/FaceCapture.tsx'
import { Button, ErrorText, Field } from '../components/ui.tsx'
import { errorMessage, post } from '../lib/api.ts'
import { CNIC_PATTERN, formatCnic } from '../lib/cnic.ts'

type Challenge = { challengeToken: string; actions: LivenessAction[] }
type FaceResult = {
  faceToken: string
  next: 'WEBAUTHN_LOGIN' | 'WEBAUTHN_ENROL'
  recoveryPending: boolean
}
type Session = { accessToken: string }
type Step = 'cnic' | 'face' | 'checking' | 'device' | 'recovery-sent'

/** UC-02 Login: CNIC → live face (factor 1) → this device's fingerprint/screen lock (factor 2). */
export default function LoginPage() {
  const { voter, signedIn } = useVoterAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('cnic')
  const [cnic, setCnic] = useState('')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [face, setFace] = useState<FaceResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (voter) return <Navigate to="/voter" replace />

  async function guarded(action: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (err) {
      // The browser's own "cancelled / not allowed" errors are DOMExceptions with a clear message.
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function onCnic(e: FormEvent) {
    e.preventDefault()
    if (!CNIC_PATTERN.test(cnic)) {
      setError('CNIC must be 13 digits, like 35202-1234567-1')
      return
    }
    void guarded(async () => {
      setChallenge(await post<Challenge>('/auth/voter/challenge'))
      setStep('face')
    })
  }

  async function onCapture(frames: string[]) {
    setStep('checking')
    try {
      setFace(
        await post<FaceResult>('/auth/voter/face', {
          cnic,
          challengeToken: challenge!.challengeToken,
          frames,
        }),
      )
      setStep('device')
    } catch (err) {
      setError(errorMessage(err))
      setStep('cnic')
    }
  }

  const useDevice = () =>
    guarded(async () => {
      const faceToken = face!.faceToken
      let session: Session
      if (face!.next === 'WEBAUTHN_ENROL') {
        const optionsJSON = await post<never>('/voters/me/webauthn/register/options', { faceToken })
        const response = await startRegistration({ optionsJSON })
        session = await post<Session>('/voters/me/webauthn/register/verify', {
          faceToken,
          response,
        })
      } else {
        const optionsJSON = await post<never>('/auth/voter/webauthn/options', { faceToken })
        const response = await startAuthentication({ optionsJSON })
        session = await post<Session>('/auth/voter/webauthn/verify', { faceToken, response })
      }
      await signedIn(session.accessToken)
      navigate('/voter', { replace: true })
    })

  const requestRecovery = () =>
    guarded(async () => {
      await post('/auth/voter/recovery', { faceToken: face!.faceToken })
      setStep('recovery-sent')
    })

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Voter sign in</h1>

      {step === 'cnic' && (
        <form onSubmit={onCnic} className="space-y-4" noValidate>
          <Field
            label="CNIC number"
            name="cnic"
            inputMode="numeric"
            placeholder="35202-1234567-1"
            value={cnic}
            onChange={(e) => setCnic(formatCnic(e.target.value))}
            required
          />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} className="w-full">
            Continue to face check
          </Button>
          <p className="text-sm text-gray-600">
            Not registered yet?{' '}
            <Link to="/register" className="underline">
              Register to vote
            </Link>
          </p>
        </form>
      )}

      {step === 'face' && challenge && (
        <FaceCapture actions={challenge.actions} onCapture={(f) => void onCapture(f)} />
      )}

      {step === 'checking' && (
        <p role="status" className="text-gray-700">
          Checking your face…
        </p>
      )}

      {step === 'device' && face && (
        <div className="space-y-4">
          <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-900">
            Face verified.
          </p>
          {face.next === 'WEBAUTHN_ENROL' ? (
            <p className="text-gray-700">
              Set up this device for voting. Your phone or computer will ask for your fingerprint
              (or screen lock). Only this device will be able to sign you in.
            </p>
          ) : (
            <p className="text-gray-700">
              Confirm it’s you with this device’s fingerprint or screen lock.
            </p>
          )}
          <ErrorText>{error}</ErrorText>
          <Button type="button" onClick={() => void useDevice()} disabled={busy} className="w-full">
            {face.next === 'WEBAUTHN_ENROL' ? 'Set up this device' : 'Use fingerprint'}
          </Button>
          {face.next === 'WEBAUTHN_LOGIN' &&
            (face.recoveryPending ? (
              <p className="text-sm text-gray-600">
                Your request to replace your device is waiting for an administrator.
              </p>
            ) : (
              <button
                type="button"
                className="text-sm text-gray-700 underline"
                onClick={() => void requestRecovery()}
              >
                Lost the device you registered with?
              </button>
            ))}
        </div>
      )}

      {step === 'recovery-sent' && (
        <div role="status" className="space-y-2 rounded-md bg-amber-50 p-4 text-amber-900">
          <p className="font-semibold">Request sent.</p>
          <p>
            An administrator will review it. Once approved, sign in again on your new device and set
            it up.
          </p>
        </div>
      )}
    </main>
  )
}
