import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import FaceCapture, { type LivenessAction } from '../components/FaceCapture.tsx'
import { Button, ErrorText, Field } from '../components/ui.tsx'
import { CNIC_PATTERN, formatCnic } from '../lib/cnic.ts'
import { errorMessage, post } from '../lib/api.ts'

type Details = { name: string; email: string; cnic: string }
type Challenge = { challengeToken: string; actions: LivenessAction[] }
type Step = 'details' | 'capture' | 'submitting' | 'done'

/** UC-01 Register Voter: personal details, then a live face capture. */
export default function RegisterPage() {
  const [step, setStep] = useState<Step>('details')
  const [details, setDetails] = useState<Details>({ name: '', email: '', cnic: '' })
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [error, setError] = useState('')

  async function beginCapture() {
    setError('')
    try {
      setChallenge(await post<Challenge>('/voters/register/challenge'))
      setStep('capture')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  function onDetails(e: FormEvent) {
    e.preventDefault()
    if (!CNIC_PATTERN.test(details.cnic)) {
      setError('CNIC must be 13 digits, like 35202-1234567-1')
      return
    }
    void beginCapture()
  }

  async function onCapture(frames: string[]) {
    setStep('submitting')
    try {
      await post('/voters/register', {
        ...details,
        challengeToken: challenge!.challengeToken,
        frames,
      })
      setStep('done')
    } catch (err) {
      setError(errorMessage(err))
      setStep('details')
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold">Voter registration</h1>

      {step === 'details' && (
        <form onSubmit={onDetails} className="mt-6 space-y-4" noValidate>
          <Field
            label="Full name (as on CNIC)"
            name="name"
            autoComplete="name"
            required
            minLength={2}
            value={details.name}
            onChange={(e) => setDetails({ ...details, name: e.target.value })}
          />
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={details.email}
            onChange={(e) => setDetails({ ...details, email: e.target.value })}
          />
          <Field
            label="CNIC number"
            name="cnic"
            inputMode="numeric"
            placeholder="35202-1234567-1"
            required
            value={details.cnic}
            onChange={(e) => setDetails({ ...details, cnic: formatCnic(e.target.value) })}
          />
          <ErrorText>{error}</ErrorText>
          <p className="text-sm text-gray-600">
            Next you will do a short face check with your camera. Your face is stored only as an
            encrypted template, never as a photo.
          </p>
          <Button type="submit" className="w-full">
            Continue to face check
          </Button>
        </form>
      )}

      {step === 'capture' && challenge && (
        <div className="mt-6">
          <p className="mb-4 text-gray-700">
            Make sure you are alone, in good light, and follow the instructions on the video.
          </p>
          <FaceCapture actions={challenge.actions} onCapture={(f) => void onCapture(f)} />
        </div>
      )}

      {step === 'submitting' && (
        <p role="status" className="mt-6 text-gray-700">
          Checking your face…
        </p>
      )}

      {step === 'done' && (
        <div role="status" className="mt-6 space-y-3 rounded-md bg-emerald-50 p-4 text-emerald-900">
          <p className="font-semibold">Registration submitted.</p>
          <p>
            An administrator will review it. Once approved, you can set up your device and vote.
          </p>
          <Link to="/" className="underline">
            Back to home
          </Link>
        </div>
      )}
    </main>
  )
}
