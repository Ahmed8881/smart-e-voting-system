import { useCallback, useEffect, useState } from 'react'
import { ErrorText } from '../../components/ui.tsx'
import { api, errorMessage, post } from '../../lib/api.ts'

type Request = {
  id: string
  createdAt: string
  voter: { id: string; name: string; cnic: string; email: string; status: string } | null
}

/** Lost-device recovery: approving revokes the voter's old devices so they can enrol a new one. */
export default function RecoveryPage() {
  const [requests, setRequests] = useState<Request[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api<Request[]>('/admin/recovery-requests')
      .then(setRequests)
      .catch((err) => setError(errorMessage(err)))
  }, [])
  useEffect(load, [load])

  async function decide(request: Request, decision: 'approve' | 'reject') {
    setError('')
    try {
      await post(`/admin/recovery-requests/${request.id}/${decision}`)
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">Device recovery requests</h1>
      <p className="mb-4 text-sm text-gray-600">
        Each voter below passed a live face check before asking. Approve only after confirming their
        identity (e.g. in person or by phone): approval revokes their old device.
      </p>
      <ErrorText>{error}</ErrorText>
      <div
        className="relative overflow-x-auto rounded-md border bg-white"
        tabIndex={0}
        role="region"
        aria-label="Recovery requests table"
      >
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-3 py-2">Voter</th>
              <th className="px-3 py-2">CNIC</th>
              <th className="px-3 py-2">Requested</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {requests?.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{r.voter?.name ?? 'Unknown'}</td>
                <td className="px-3 py-2 font-mono whitespace-nowrap">{r.voter?.cnic}</td>
                <td className="px-3 py-2">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="space-x-3 px-3 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    aria-label={`Approve recovery for ${r.voter?.name}`}
                    className="text-emerald-800 underline"
                    onClick={() => void decide(r, 'approve')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    aria-label={`Reject recovery for ${r.voter?.name}`}
                    className="text-red-800 underline"
                    onClick={() => void decide(r, 'reject')}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
            {requests?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                  No pending requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
