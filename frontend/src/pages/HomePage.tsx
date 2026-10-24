import { useEffect, useState } from 'react'

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
    </main>
  )
}
