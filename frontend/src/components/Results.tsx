import { Suspense, lazy } from 'react'

export type CandidateResult = {
  candidateId: string
  name: string
  party: string
  votes: number
  percent: number
}
export type Turnout = { voted: number; eligible: number; percent: number }

/** Turnout is one headline number, so a stat tile — not a chart. */
export function TurnoutTile({ turnout, live = false }: { turnout: Turnout; live?: boolean }) {
  return (
    <div className="rounded-md border bg-white p-4">
      <p className="text-sm text-gray-600">Turnout{live && ' (live, updates every 10 s)'}</p>
      <p className="text-3xl font-semibold tabular-nums">{turnout.percent}%</p>
      <div
        role="progressbar"
        aria-label="Turnout"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={turnout.percent}
        className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200"
      >
        <div
          className="h-full rounded-full bg-emerald-700"
          style={{ width: `${Math.min(100, turnout.percent)}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-gray-600 tabular-nums">
        {turnout.voted} of {turnout.eligible} eligible voters
      </p>
    </div>
  )
}

// Recharts is large; load it only on screens that show results.
const ResultsChart = lazy(() => import('./ResultsChart.tsx'))

/** Chart (loaded on demand) + table. The table is always there for screen readers and print. */
export function ResultsView({
  results,
  totalVotes,
}: {
  results: CandidateResult[]
  totalVotes: number
}) {
  return (
    <figure className="space-y-4">
      <figcaption className="text-sm text-gray-600">
        Votes per candidate · {totalVotes} votes cast
      </figcaption>
      <Suspense fallback={<p className="text-gray-600">Loading chart…</p>}>
        <ResultsChart results={results} />
      </Suspense>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Results table</caption>
        <thead className="text-gray-600">
          <tr>
            <th className="py-1">Candidate</th>
            <th className="py-1">Party</th>
            <th className="py-1 text-right">Votes</th>
            <th className="py-1 text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.candidateId} className="border-t">
              <td className="py-1 font-medium">{r.name}</td>
              <td className="py-1">{r.party}</td>
              <td className="py-1 text-right tabular-nums">{r.votes}</td>
              <td className="py-1 text-right tabular-nums">{r.percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
