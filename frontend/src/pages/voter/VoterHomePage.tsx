import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ErrorText } from '../../components/ui.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import { formatDateTime } from '../../lib/dates.ts'

type ActiveElection = {
  id: string
  title: string
  description: string
  endsAt: string
  startsAt: string
  hasVoted: boolean
  open: boolean
}
type Participation = { id: string; title: string; status: string; votedAt: string }
type Published = { id: string; title: string; endsAt: string }

/** UC-03 View Ongoing Elections + UC-07 View Vote History. */
export default function VoterHomePage() {
  const [elections, setElections] = useState<ActiveElection[] | null>(null)
  const [history, setHistory] = useState<Participation[] | null>(null)
  const [published, setPublished] = useState<Published[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api<ActiveElection[]>('/elections/active'),
      api<Participation[]>('/me/participation'),
      api<Published[]>('/elections/published'),
    ])
      .then(([e, h, p]) => {
        setElections(e)
        setHistory(h)
        setPublished(p)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Open elections</h2>
        <ErrorText>{error}</ErrorText>
        <ul className="space-y-3">
          {elections?.map((e) => (
            <li key={e.id} className="rounded-md border bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{e.title}</span>
                {e.hasVoted ? (
                  <span className="ml-auto rounded bg-emerald-100 px-2 py-0.5 text-sm text-emerald-900">
                    You voted
                  </span>
                ) : e.open ? (
                  <Link
                    to={`/voter/elections/${e.id}`}
                    className="ml-auto rounded-md bg-emerald-700 px-4 py-2 font-medium text-white"
                  >
                    Vote
                  </Link>
                ) : (
                  <span className="ml-auto text-sm text-gray-600">
                    Opens {formatDateTime(e.startsAt)}
                  </span>
                )}
              </div>
              {e.description && <p className="mt-1 text-sm text-gray-700">{e.description}</p>}
              <p className="mt-1 text-sm text-gray-600">Closes {formatDateTime(e.endsAt)}</p>
            </li>
          ))}
          {elections?.length === 0 && (
            <li className="text-gray-600">There are no open elections right now.</li>
          )}
        </ul>
      </section>

      {published.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Results</h2>
          <ul className="space-y-1">
            {published.map((p) => (
              <li key={p.id}>
                <Link to={`/voter/elections/${p.id}/results`} className="underline">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Your voting history</h2>
        <ul className="space-y-1 text-gray-700">
          {history?.map((h) => (
            <li key={h.id}>
              You voted in <span className="font-medium">{h.title}</span> on{' '}
              {formatDateTime(h.votedAt)}
              {h.status === 'PUBLISHED' && (
                <>
                  {' '}
                  ·{' '}
                  <Link to={`/voter/elections/${h.id}/results`} className="underline">
                    results
                  </Link>
                </>
              )}
            </li>
          ))}
          {history?.length === 0 && <li>You haven’t voted yet.</li>}
        </ul>
      </section>
    </div>
  )
}
