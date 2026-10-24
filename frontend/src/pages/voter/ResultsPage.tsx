import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  ResultsView,
  TurnoutTile,
  type CandidateResult,
  type Turnout,
} from '../../components/Results.tsx'
import { ErrorText } from '../../components/ui.tsx'
import { api, errorMessage } from '../../lib/api.ts'

type PublishedResults = {
  election: { id: string; title: string }
  turnout: Turnout
  totalVotes: number
  results: CandidateResult[]
}

/** UC-06 View Results — published elections only. */
export default function ResultsPage() {
  const { id } = useParams()
  const [data, setData] = useState<PublishedResults | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<PublishedResults>(`/elections/${id}/results`)
      .then(setData)
      .catch((err) => setError(errorMessage(err)))
  }, [id])

  return (
    <section className="space-y-4">
      <Link to="/voter" className="text-sm underline">
        ← Back
      </Link>
      <ErrorText>{error}</ErrorText>
      {data && (
        <>
          <h2 className="text-xl font-semibold">{data.election.title} — results</h2>
          <TurnoutTile turnout={data.turnout} />
          <ResultsView results={data.results} totalVotes={data.totalVotes} />
        </>
      )}
    </section>
  )
}
