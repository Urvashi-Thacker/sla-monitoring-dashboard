import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import UploadPage from './pages/UploadPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden>◉</span>
          SLA Monitor
        </span>
        <nav>
          <NavLink to="/upload">Upload</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}
