import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ErrorText } from '../../components/ui.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import { formatDateTime } from '../../lib/dates.ts'

type Severity = 'LOW' | 'MEDIUM' | 'HIGH'
type AlertStatus = 'OPEN' | 'REVIEWED' | 'DISMISSED'
type Alert = {
  id: string
  type: string
  severity: Severity
  status: AlertStatus
  score: number | null
  description: string
  details: unknown
  createdAt: string
  voter: { id: string; name: string; cnic: string; status: string } | null
  election: { id: string; title: string } | null
}
type Page = { items: Alert[]; total: number; openBySeverity: Partial<Record<Severity, number>> }

// Severity is a status: colour + icon + word, never colour alone.
const SEVERITY: Record<Severity, { cls: string; icon: string }> = {
  HIGH: { cls: 'bg-red-100 text-red-900', icon: '▲' },
  MEDIUM: { cls: 'bg-amber-100 text-amber-900', icon: '●' },
  LOW: { cls: 'bg-gray-200 text-gray-800', icon: '○' },
}

/** UC-11 Monitor Fraud Alerts — review workflow. */
export default function FraudAlertsPage() {
  const [status, setStatus] = useState<AlertStatus | ''>('OPEN')
  const [data, setData] = useState<Page | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api<Page>(`/admin/fraud-alerts${status ? `?status=${status}` : ''}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err)))
  }, [status])
  useEffect(load, [load])

  async function review(alert: Alert, to: 'REVIEWED' | 'DISMISSED') {
    setError('')
    try {
      await api(`/admin/fraud-alerts/${alert.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: to }),
      })
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">Fraud alerts</h1>
      {data && (
        <p className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Open alerts by severity">
          {(['HIGH', 'MEDIUM', 'LOW'] as const).map((s) => (
            <span key={s} className={`rounded px-2 py-1 ${SEVERITY[s].cls}`}>
              <span aria-hidden="true">{SEVERITY[s].icon} </span>
              {data.openBySeverity[s] ?? 0} open {s.toLowerCase()}
            </span>
          ))}
        </p>
      )}
      <label className="mb-4 flex items-center gap-2 text-sm">
        Show
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as AlertStatus | '')}
          className="rounded-md border border-gray-300 px-2 py-1"
        >
          <option value="OPEN">Open</option>
          <option value="REVIEWED">Reviewed</option>
          <option value="DISMISSED">Dismissed</option>
          <option value="">All</option>
        </select>
      </label>
      <ErrorText>{error}</ErrorText>

      <ul className="space-y-3">
        {data?.items.map((a) => (
          <li key={a.id} className="rounded-md border bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY[a.severity].cls}`}
              >
                <span aria-hidden="true">{SEVERITY[a.severity].icon} </span>
                {a.severity}
              </span>
              <span className="font-mono text-sm">{a.type}</span>
              <span className="ml-auto text-sm text-gray-600">{formatDateTime(a.createdAt)}</span>
            </div>
            <p className="mt-2">{a.description}</p>
            <p className="mt-1 text-sm text-gray-700">
              {a.voter && (
                <>
                  Voter: {a.voter.name} ({a.voter.cnic}) — now {a.voter.status}
                  {a.voter.status === 'LOCKED' && (
                    <>
                      {' · '}
                      <Link to="/admin/voters" className="underline">
                        review in Voters to unlock
                      </Link>
                    </>
                  )}
                </>
              )}
              {a.election && <> Election: {a.election.title}</>}
              {a.score !== null && <> · score {a.score.toFixed(2)}</>}
            </p>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-gray-600">Details</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-xs">
                {JSON.stringify(a.details, null, 2)}
              </pre>
            </details>
            {a.status === 'OPEN' ? (
              <div className="mt-3 flex gap-4 text-sm">
                <button
                  type="button"
                  className="text-emerald-800 underline"
                  onClick={() => void review(a, 'REVIEWED')}
                >
                  Mark reviewed
                </button>
                <button
                  type="button"
                  className="text-gray-700 underline"
                  onClick={() => void review(a, 'DISMISSED')}
                >
                  Dismiss (false alarm)
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-600">{a.status}</p>
            )}
          </li>
        ))}
        {data?.items.length === 0 && <li className="text-gray-600">No alerts.</li>}
      </ul>
    </section>
  )
}
