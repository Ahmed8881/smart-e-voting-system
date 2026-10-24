import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { Button, ErrorText, Field } from '../../components/ui.tsx'
import { api, errorMessage, post } from '../../lib/api.ts'
import { formatDateTime } from '../../lib/dates.ts'
import { STATUS_BADGE, type ElectionStatus } from '../../lib/elections.ts'
import ElectionOutcome from './ElectionOutcome.tsx'

type Candidate = { id: string; name: string; party: string; symbolUrl: string | null }
type Election = {
  id: string
  title: string
  description: string
  status: ElectionStatus
  startsAt: string
  endsAt: string
  candidates: Candidate[]
}

const NEXT_ACTION: Partial<
  Record<ElectionStatus, { action: string; label: string; confirm: string }>
> = {
  DRAFT: {
    action: 'schedule',
    label: 'Schedule',
    confirm: 'Schedule this election? Candidates can still change until it opens.',
  },
  SCHEDULED: {
    action: 'open',
    label: 'Open voting',
    confirm: 'Open voting now? Candidates will be locked and cannot be changed.',
  },
  ACTIVE: {
    action: 'close',
    label: 'Close voting',
    confirm: 'Close voting now? No more votes will be accepted.',
  },
  CLOSED: {
    action: 'publish',
    label: 'Publish results',
    confirm: 'Publish the results to all voters?',
  },
}

/** UC-08/UC-09: one election's details, candidates and lifecycle. */
export default function ElectionDetailPage() {
  const { id } = useParams()
  const [election, setElection] = useState<Election | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api<Election>(`/admin/elections/${id}`)
      .then(setElection)
      .catch((err) => setError(errorMessage(err)))
  }, [id])
  useEffect(load, [load])

  async function run(action: () => Promise<unknown>) {
    setError('')
    try {
      await action()
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  function addCandidate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formEl = e.currentTarget
    const form = new FormData(formEl)
    void run(async () => {
      await post(`/admin/elections/${id}/candidates`, {
        name: form.get('name'),
        party: form.get('party'),
        symbolUrl: form.get('symbolUrl') || null,
      })
      formEl.reset()
    })
  }

  if (!election) return <ErrorText>{error}</ErrorText>
  const editable = election.status === 'DRAFT' || election.status === 'SCHEDULED'
  const next = NEXT_ACTION[election.status]

  return (
    <section className="space-y-6">
      <div>
        <Link to="/admin/elections" className="text-sm underline">
          ← All elections
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{election.title}</h1>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[election.status]}`}
          >
            {election.status}
          </span>
          {next && (
            <Button
              type="button"
              className="ml-auto"
              onClick={() =>
                window.confirm(next.confirm) &&
                void run(() => post(`/admin/elections/${id}/${next.action}`))
              }
            >
              {next.label}
            </Button>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-600">
          {formatDateTime(election.startsAt)} – {formatDateTime(election.endsAt)}
        </p>
        {election.description && <p className="mt-2 text-gray-700">{election.description}</p>}
      </div>

      <ErrorText>{error}</ErrorText>

      <ElectionOutcome id={election.id} status={election.status} />

      <div>
        <h2 className="mb-2 font-semibold">Candidates ({election.candidates.length})</h2>
        {!editable && (
          <p className="mb-2 text-sm text-gray-600">
            Voting has started, so candidates are locked.
          </p>
        )}
        <ul className="divide-y rounded-md border bg-white">
          {election.candidates.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2">
              {c.symbolUrl && <img src={c.symbolUrl} alt="" className="h-8 w-8 object-contain" />}
              <span className="font-medium">{c.name}</span>
              <span className="text-gray-600">{c.party}</span>
              {editable && (
                <button
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  className="ml-auto text-sm text-red-800 underline"
                  onClick={() =>
                    void run(() =>
                      api(`/admin/elections/${id}/candidates/${c.id}`, { method: 'DELETE' }),
                    )
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          {election.candidates.length === 0 && (
            <li className="px-4 py-3 text-gray-500">No candidates yet.</li>
          )}
        </ul>

        {editable && (
          <form
            onSubmit={addCandidate}
            className="mt-3 grid gap-3 rounded-md border bg-white p-4 sm:grid-cols-4 sm:items-end"
          >
            <Field label="Name" name="name" required minLength={2} />
            <Field label="Party" name="party" required />
            <Field label="Symbol image URL (https, optional)" name="symbolUrl" type="url" />
            <Button type="submit">Add candidate</Button>
          </form>
        )}
      </div>
    </section>
  )
}
