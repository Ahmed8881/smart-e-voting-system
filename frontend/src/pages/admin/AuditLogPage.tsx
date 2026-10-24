import { useEffect, useState } from 'react'
import { Button, ErrorText } from '../../components/ui.tsx'
import { api, errorMessage } from '../../lib/api.ts'

type Entry = {
  id: number
  actorType: string
  actorId: string | null
  action: string
  payload: unknown
  createdAt: string
}
type Page = { items: Entry[]; total: number; page: number; pageSize: number }
type Verification =
  | { valid: true; checked: number }
  | { valid: false; checked: number; brokenAtId: number | null; reason: string }

const PAGE_SIZE = 25

export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Page>(`/admin/audit-log?page=${page}&pageSize=${PAGE_SIZE}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err)))
  }, [page])

  async function verify() {
    setError('')
    try {
      setVerification(await api<Verification>('/admin/audit-log/verify'))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <Button type="button" onClick={() => void verify()} className="ml-auto">
          Verify integrity
        </Button>
      </div>

      <div aria-live="polite">
        {verification?.valid === true && (
          <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-emerald-900">
            Chain intact — {verification.checked} entries verified.
          </p>
        )}
        {verification?.valid === false && (
          <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-red-900">
            Tampering detected ({verification.reason})
            {verification.brokenAtId !== null && ` at entry #${verification.brokenAtId}`} after{' '}
            {verification.checked} valid entries.
          </p>
        )}
      </div>
      <ErrorText>{error}</ErrorText>

      <div className="overflow-x-auto rounded-md border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((e) => (
              <tr key={e.id} className="border-t align-top">
                <td className="px-3 py-2">{e.id}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">{e.actorType}</td>
                <td className="px-3 py-2 font-mono">{e.action}</td>
                <td className="px-3 py-2 font-mono text-xs break-all">
                  {JSON.stringify(e.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3 text-sm">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          className="underline disabled:opacity-40"
        >
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
          className="underline disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </section>
  )
}
