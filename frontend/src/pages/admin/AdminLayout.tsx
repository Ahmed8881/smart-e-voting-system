import { NavLink, Outlet } from 'react-router'
import { useAdminAuth } from '../../auth/AdminAuth.tsx'

const links = [
  { to: '/admin/elections', label: 'Elections' },
  { to: '/admin/voters', label: 'Voters' },
  { to: '/admin/recovery', label: 'Device recovery' },
  { to: '/admin/audit-log', label: 'Audit log' },
  { to: '/admin/settings', label: 'Settings' },
]

export default function AdminLayout() {
  const { admin, logout } = useAdminAuth()
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold">E-Voting Admin</span>
          <nav aria-label="Admin" className="flex gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `rounded px-3 py-1.5 text-sm ${isActive ? 'bg-emerald-50 text-emerald-800' : 'text-gray-700 hover:bg-gray-100'}`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-gray-600">{admin?.email}</span>
            <button type="button" onClick={() => void logout()} className="underline">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
