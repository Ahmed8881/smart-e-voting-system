import { Route, Routes } from 'react-router'
import HomePage from './pages/HomePage.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={<p className="p-6">Page not found.</p>} />
    </Routes>
  )
}
