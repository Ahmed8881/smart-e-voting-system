import { useEffect, useState } from 'react'
import { Link } from 'react-router'

type Status = 'checking' | 'ok' | 'down'

export default function HomePage() {
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setStatus(res.ok ? 'ok' : 'down'))
      .catch(() => setStatus('down'))
  }, [])

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Smart E-Voting System</h1>
      <p className="mt-2 text-gray-600" role="status">
        Backend: {status === 'checking' ? 'checking…' : status === 'ok' ? 'online' : 'unreachable'}
      </p>
      <nav aria-label="Main" className="mt-6 flex flex-wrap gap-3">
        <Link to="/register" className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white">
          Register to vote
        </Link>
        <Link to="/admin" className="rounded-md px-4 py-2 ring-1 ring-gray-300">
          Admin
        </Link>
      </nav>
    </main>
  )
}
