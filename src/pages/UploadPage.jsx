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
      <p className="muted">
        The file is sent to a serverless cloud function that parses, validates and cleans it, then saves the result to
        Postgres.
      </p>

      <label
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]) }}
      >
        <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files[0])} hidden />
        {file ? (
          <span><strong>{file.name}</strong> ({(file.size / 1024).toFixed(0)} KB)</span>
        ) : (
          <span>Drag a CSV here or <u>browse</u></span>
        )}
      </label>

      <button className="primary" disabled={!file || busy} onClick={submit}>
        {busy ? 'Processing in cloud function…' : 'Upload & process'}
      </button>

      {error && <div className="alert error">{error}</div>}

      {result && (
        <div className="card result">
          <h2>Processed: {result.filename}</h2>
          <div className="tiles">
            <div className="tile"><span className="label">Rows in file</span><span className="value">{result.total_rows.toLocaleString()}</span></div>
            <div className="tile"><span className="label">Accepted</span><span className="value ok">{result.accepted_rows.toLocaleString()}</span></div>
            <div className="tile"><span className="label">Rejected</span><span className="value bad">{result.rejected_rows.toLocaleString()}</span></div>
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
