import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button, ErrorText, Field } from '../../components/ui.tsx'
import { api, errorMessage, post } from '../../lib/api.ts'
import { formatDateTime, fromLocalInput } from '../../lib/dates.ts'
import { STATUS_BADGE, type ElectionStatus } from '../../lib/elections.ts'

type Election = {
  id: string
  title: string
  status: ElectionStatus
  startsAt: string
  endsAt: string
  candidateCount: number
}

/** UC-08 Manage Elections: list and create. */
export default function ElectionsPage() {
  const [elections, setElections] = useState<Election[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    api<Election[]>('/admin/elections')
      .then(setElections)
      .catch((err) => setError(errorMessage(err)))
  }, [])
  useEffect(load, [load])

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setError('')
    try {
      await post('/admin/elections', {
        title: form.get('title'),
        description: form.get('description'),
        startsAt: fromLocalInput(String(form.get('startsAt'))),
        endsAt: fromLocalInput(String(form.get('endsAt'))),
      })
      setCreating(false)
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Elections</h1>
        {!creating && (
          <Button type="button" className="ml-auto" onClick={() => setCreating(true)}>
            New election
          </Button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="mb-6 max-w-lg space-y-3 rounded-md border bg-white p-4"
        >
          <Field label="Title (one position per election)" name="title" required minLength={3} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Description</span>
            <textarea
              name="description"
              rows={2}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Voting opens" name="startsAt" type="datetime-local" required />
            <Field label="Voting closes" name="endsAt" type="datetime-local" required />
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-3">
            <Button type="submit">Create draft</Button>
            <button type="button" className="underline" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!creating && <ErrorText>{error}</ErrorText>}

      <ul className="space-y-2">
        {elections?.map((e) => (
          <li key={e.id}>
            <Link
              to={`/admin/elections/${e.id}`}
              className="flex flex-wrap items-center gap-3 rounded-md border bg-white px-4 py-3 hover:border-emerald-700"
            >
              <span className="font-medium">{e.title}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[e.status]}`}>
                {e.status}
              </span>
              <span className="ml-auto text-sm text-gray-600">
                {formatDateTime(e.startsAt)} – {formatDateTime(e.endsAt)} · {e.candidateCount}{' '}
                candidate(s)
              </span>
            </Link>
          </li>
        ))}
        {elections?.length === 0 && <li className="text-gray-500">No elections yet.</li>}
      </ul>
    </section>
  )
}
