import { Link, Outlet } from 'react-router'
import { useVoterAuth } from '../../auth/VoterAuth.tsx'

export default function VoterLayout() {
  const { voter, logout } = useVoterAuth()
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link to="/voter" className="font-semibold">
            Smart E-Voting
          </Link>
          <span className="ml-auto text-sm text-gray-600">{voter?.name}</span>
          <button type="button" onClick={() => void logout()} className="text-sm underline">
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
