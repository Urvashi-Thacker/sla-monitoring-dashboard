import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtUtc } from '../api.js'
import StatsSection from '../components/StatsSection.jsx'
import LogsSection from '../components/LogsSection.jsx'

export default function DashboardPage() {
  const [params, setParams] = useSearchParams()
  const [uploads, setUploads] = useState(null)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [focus, setFocus] = useState(null)

  const uploadId = params.get('upload') ? Number(params.get('upload')) : uploads?.[0]?.id

  useEffect(() => {
    api.uploads().then(setUploads).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!uploadId) return
    setStats(null)
    setFocus(null)
    api.stats(uploadId).then(setStats).catch((e) => setError(e.message))
  }, [uploadId])

  if (error) return <div className="page"><div className="alert error">{error}</div></div>
  if (!uploads) return <div className="page muted">Loading…</div>
  if (uploads.length === 0)
    return (
      <div className="page">
        <p>No data yet. <Link to="/upload">Upload a CSV</Link> to get started.</p>
      </div>
    )

  return (
    <div className="page">
      <div className="page-head">
        <h1>SLA dashboard</h1>
        <label className="upload-select">
          Dataset
          <select value={uploadId} onChange={(e) => setParams({ upload: e.target.value })}>
            {uploads.map((u) => (
              <option key={u.id} value={u.id}>
                #{u.id} {u.filename} ({fmtUtc(u.uploaded_at).slice(0, 10)})
              </option>
            ))}
          </select>
        </label>
      </div>

      {stats ? (
        <>
          <StatsSection stats={stats} onFocus={setFocus} />
          <LogsSection key={uploadId} uploadId={uploadId} stats={stats} focus={focus} />
        </>
      ) : (
        <p className="muted">Loading stats…</p>
      )}
    </div>
  )
}
