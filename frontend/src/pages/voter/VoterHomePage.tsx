import { useVoterAuth } from '../../auth/VoterAuth.tsx'

/** Signed-in voter's landing page. Elections are listed here from Phase 6. */
export default function VoterHomePage() {
  const { voter, logout } = useVoterAuth()
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-semibold">Welcome, {voter?.name}</h1>
        <button type="button" onClick={() => void logout()} className="ml-auto text-sm underline">
          Sign out
        </button>
      </div>
      <p className="mt-4 text-gray-700">You are signed in. There are no open elections yet.</p>
    </main>
  )
}
