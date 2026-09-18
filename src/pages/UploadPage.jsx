import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtUtc, ISSUE_LABELS } from '../api.js'

export default function UploadPage() {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [dragging, setDragging] = useState(false)

  const pick = (f) => {
    setError('')
    setResult(null)
    if (f && !f.name.toLowerCase().endsWith('.csv')) {
      setError('Please choose a .csv file')
      return
    }
    setFile(f || null)
  }

  const submit = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      setResult(await api.upload(file))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page narrow">
      <h1>Upload health-check CSV</h1>
      <p className="muted">Upload a monitoring export to see service availability, outages and check logs.</p>

      <label
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]) }}
      >
        <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files[0])} hidden />
        <span className="drop-icon" aria-hidden>⇪</span>
        {file ? (
          <span><strong>{file.name}</strong> <span className="muted">({(file.size / 1024).toFixed(0)} KB) · click to change</span></span>
        ) : (
          <span>Drag a CSV here or <u>browse</u><br /><span className="muted small">Max 4 MB</span></span>
        )}
      </label>

      <button className="primary wide" disabled={!file || busy} onClick={submit}>
        {busy ? <><span className="spinner" aria-hidden /> Processing…</> : 'Upload & process'}
      </button>

      {error && <div className="alert error">{error}</div>}

      {result && (
        <div className="card result">
          <h2>Processed: {result.filename}</h2>
          <div className="kpis">
            <div className="kpi"><span className="kpi-label">Rows in file</span><span className="kpi-value">{result.total_rows.toLocaleString()}</span></div>
            <div className="kpi good"><span className="kpi-label">Accepted</span><span className="kpi-value">{result.accepted_rows.toLocaleString()}</span></div>
            <div className="kpi critical"><span className="kpi-label">Rejected</span><span className="kpi-value">{result.rejected_rows.toLocaleString()}</span></div>
          </div>
          <p className="muted">Data covers {fmtUtc(result.period_start)} → {fmtUtc(result.period_end)}</p>
          <h3>What the cleaning did</h3>
          <ul className="issues">
            {Object.entries(result.issues).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k}><span>{ISSUE_LABELS[k] || k}</span><strong>{v.toLocaleString()}</strong></li>
            ))}
          </ul>
          <Link className="primary button" to={`/dashboard?upload=${result.upload_id}`}>Open dashboard →</Link>
        </div>
      )}
    </div>
  )
}
