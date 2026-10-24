import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { Button, ErrorText } from '../../components/ui.tsx'
import { api, errorMessage, post } from '../../lib/api.ts'
import { formatDateTime } from '../../lib/dates.ts'

type Candidate = { id: string; name: string; party: string; symbolUrl: string | null }
type Ballot = { election: { id: string; title: string; endsAt: string }; candidates: Candidate[] }
type Step = 'choose' | 'confirm' | 'done'

/** UC-04 View Candidates + UC-05 Cast Vote, with an explicit confirmation step. */
export default function BallotPage() {
  const { id } = useParams()
  const [ballot, setBallot] = useState<Ballot | null>(null)
  const [choice, setChoice] = useState<Candidate | null>(null)
  const [step, setStep] = useState<Step>('choose')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Ballot>(`/elections/${id}/candidates`)
      .then(setBallot)
      .catch((err) => setError(errorMessage(err)))
  }, [id])

  function onChoose(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const candidateId = new FormData(e.currentTarget).get('candidate')
    const selected = ballot?.candidates.find((c) => c.id === candidateId)
    if (!selected) {
      setError('Choose a candidate first.')
      return
    }
    setError('')
    setChoice(selected)
    setStep('confirm')
  }

  async function onConfirm() {
    setBusy(true)
    setError('')
    try {
      await post(`/elections/${id}/vote`, { candidateId: choice!.id })
      setChoice(null) // don't keep the choice around once it's cast
      setStep('done')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!ballot) return <ErrorText>{error}</ErrorText>

  return (
    <section className="max-w-lg">
      <Link to="/voter" className="text-sm underline">
        ← Back
      </Link>
      <h2 className="mt-2 text-xl font-semibold">{ballot.election.title}</h2>
      <p className="mb-4 text-sm text-gray-600">
        Voting closes {formatDateTime(ballot.election.endsAt)}
      </p>

      {step === 'choose' && (
        <form onSubmit={onChoose} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium">Choose one candidate</legend>
            {ballot.candidates.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border bg-white p-3 has-[:checked]:border-emerald-700 has-[:checked]:ring-1 has-[:checked]:ring-emerald-700"
              >
                <input
                  type="radio"
                  name="candidate"
                  value={c.id}
                  defaultChecked={c.id === choice?.id}
                  className="h-5 w-5 accent-emerald-700"
                />
                {c.symbolUrl && (
                  <img src={c.symbolUrl} alt="" className="h-10 w-10 object-contain" />
                )}
                <span>
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-sm text-gray-600">{c.party}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full">
            Review my vote
          </Button>
        </form>
      )}

      {step === 'confirm' && choice && (
        <div className="space-y-4">
          <div className="rounded-md border-2 border-emerald-700 bg-white p-4">
            <p className="text-sm text-gray-600">You are voting for</p>
            <p className="text-lg font-semibold">{choice.name}</p>
            <p className="text-gray-700">{choice.party}</p>
          </div>
          <p className="text-sm text-gray-700">Once cast, your vote cannot be changed.</p>
          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => void onConfirm()} disabled={busy}>
              Confirm and cast vote
            </Button>
            <button
              type="button"
              className="underline"
              onClick={() => setStep('choose')}
              disabled={busy}
            >
              Change my choice
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div role="status" className="space-y-2 rounded-md bg-emerald-50 p-4 text-emerald-900">
          <p className="font-semibold">Your vote has been recorded.</p>
          <p>Your ballot is stored without your name. Results appear after the election closes.</p>
          <Link to="/voter" className="underline">
            Back to elections
          </Link>
        </div>
      )}
    </section>
  )
}
