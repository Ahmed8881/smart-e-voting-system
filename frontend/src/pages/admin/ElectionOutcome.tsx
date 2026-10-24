import { useEffect, useState } from 'react'
import {
  ResultsView,
  TurnoutTile,
  type CandidateResult,
  type Turnout,
} from '../../components/Results.tsx'
import { ErrorText } from '../../components/ui.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import type { ElectionStatus } from '../../lib/elections.ts'

type AdminResults = {
  turnout: Turnout
  totalVotes: number
  consistent: boolean
  results: CandidateResult[]
}

const POLL_MS = 10_000

/** ACTIVE: live turnout only (brief §5.7). CLOSED/PUBLISHED: the tally. Earlier: nothing to show. */
export default function ElectionOutcome({ id, status }: { id: string; status: ElectionStatus }) {
  const [turnout, setTurnout] = useState<Turnout | null>(null)
  const [results, setResults] = useState<AdminResults | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (status !== 'ACTIVE') return
    const load = () =>
      api<Turnout>(`/admin/elections/${id}/turnout`)
        .then(setTurnout)
        .catch((err) => setError(errorMessage(err)))
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [id, status])

  useEffect(() => {
    if (status !== 'CLOSED' && status !== 'PUBLISHED') return
    api<AdminResults>(`/admin/elections/${id}/results`)
      .then(setResults)
      .catch((err) => setError(errorMessage(err)))
  }, [id, status])

  if (error) return <ErrorText>{error}</ErrorText>
  if (status === 'ACTIVE' && turnout) {
    return (
      <div className="space-y-2">
        <TurnoutTile turnout={turnout} live />
        <p className="text-sm text-gray-600">
          Per-candidate counts stay hidden until voting closes.
        </p>
      </div>
    )
  }
  if (results) {
    return (
      <div className="space-y-4">
        {!results.consistent && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-900">
            Integrity warning: the number of ballots does not match the number of voters who took
            part. Check the fraud alerts and audit log before publishing.
          </p>
        )}
        {status === 'CLOSED' && (
          <p className="text-sm text-gray-600">
            Voters will see these results once you publish them.
          </p>
        )}
        <TurnoutTile turnout={results.turnout} />
        <ResultsView results={results.results} totalVotes={results.totalVotes} />
      </div>
    )
  }
  return null
}
