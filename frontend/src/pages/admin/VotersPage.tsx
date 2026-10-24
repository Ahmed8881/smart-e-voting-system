import { useCallback, useEffect, useState } from 'react'
import { ErrorText } from '../../components/ui.tsx'
import { api, errorMessage, post } from '../../lib/api.ts'

type Status = 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'LOCKED'
type Voter = {
  id: string
  name: string
  email: string
  cnic: string
  status: Status
  createdAt: string
}
type Page = { items: Voter[]; total: number }

const FILTERS: (Status | 'ALL')[] = ['PENDING', 'APPROVED', 'SUSPENDED', 'LOCKED', 'ALL']
const BADGE: Record<Status, string> = {
  PENDING: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-emerald-100 text-emerald-900',
  SUSPENDED: 'bg-gray-200 text-gray-800',
  LOCKED: 'bg-red-100 text-red-900',
}

/** UC-10 Manage Voters: review registrations, approve or suspend. */
export default function VotersPage() {
  const [filter, setFilter] = useState<Status | 'ALL'>('PENDING')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<Page | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    const params = new URLSearchParams()
    if (filter !== 'ALL') params.set('status', filter)
    if (search.trim()) params.set('search', search.trim())
    api<Page>(`/admin/voters?${params}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err)))
  }, [filter, search])

  useEffect(load, [load])

  async function act(voter: Voter, action: 'approve' | 'suspend') {
    setError('')
    try {
      await post(`/admin/voters/${voter.id}/${action}`)
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">Voters</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1.5 text-sm ${filter === f ? 'bg-emerald-700 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300'}`}
            >
              {f[0] + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Search voters"
          placeholder="Search name, email or CNIC"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto w-full rounded-md border border-gray-300 px-3 py-1.5 sm:w-64"
        />
      </div>
      <ErrorText>{error}</ErrorText>

      <div
        className="relative overflow-x-auto rounded-md border bg-white"
        tabIndex={0}
        role="region"
        aria-label="Voters table"
      >
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">CNIC</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Registered</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((v) => (
              <tr key={v.id} className="border-t">
                <td className="px-3 py-2">{v.name}</td>
                <td className="px-3 py-2 font-mono whitespace-nowrap">{v.cnic}</td>
                <td className="px-3 py-2">{v.email}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(v.createdAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${BADGE[v.status]}`}>
                    {v.status}
                  </span>
                </td>
                <td className="space-x-3 px-3 py-2 text-right whitespace-nowrap">
                  {v.status !== 'APPROVED' && (
                    <button
                      type="button"
                      className="text-emerald-800 underline"
                      aria-label={`Approve ${v.name}`}
                      onClick={() => void act(v, 'approve')}
                    >
                      Approve
                    </button>
                  )}
                  {v.status !== 'SUSPENDED' && (
                    <button
                      type="button"
                      className="text-red-800 underline"
                      aria-label={`Suspend ${v.name}`}
                      onClick={() => void act(v, 'suspend')}
                    >
                      Suspend
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                  No voters found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data && <p className="mt-2 text-sm text-gray-600">{data.total} voter(s)</p>}
    </section>
  )
}
