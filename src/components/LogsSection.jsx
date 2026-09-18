import { useEffect, useState } from 'react'
import { api, fmtUtc } from '../api.js'

const PAGE_SIZE = 50
const EMPTY = { mode: 'single', date: '', from: '', to: '', service_id: '', status: '' }

export default function LogsSection({ uploadId, stats, focus }) {
  const [draft, setDraft] = useState(EMPTY)
  const [applied, setApplied] = useState(EMPTY)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const minDay = stats.period_start.slice(0, 10)
  const maxDay = new Date(new Date(stats.period_end).getTime() - 1).toISOString().slice(0, 10)

  useEffect(() => {
    if (!focus) return
    const f = { ...EMPTY, mode: 'single', date: focus.date, service_id: focus.service_id }
    setDraft(f)
    setApplied(f)
    setPage(1)
    document.getElementById('logs')?.scrollIntoView({ behavior: 'smooth' })
  }, [focus])

  useEffect(() => {
    const p = { upload_id: uploadId, page, page_size: PAGE_SIZE, service_id: applied.service_id, status: applied.status }
    if (applied.mode === 'single') p.date = applied.date
    else Object.assign(p, { from: applied.from, to: applied.to })
    setError('')
    api.logs(p).then(setData).catch((e) => setError(e.message))
  }, [uploadId, applied, page])

  const apply = (e) => {
    e.preventDefault()
    if (draft.mode === 'range' && draft.from && draft.to && draft.from > draft.to) {
      setError('"From" must be on or before "To"')
      return
    }
    setApplied(draft)
    setPage(1)
  }
  const clear = () => { setDraft(EMPTY); setApplied(EMPTY); setPage(1) }
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value })

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <section className="card" id="logs">
      <div className="logs-head">
        <h2>Check logs</h2>
        {data && (
          <span className="muted small">
            {data.total.toLocaleString()} records
            {data.total > 0 && ` · ${((page - 1) * PAGE_SIZE + 1).toLocaleString()}–${Math.min(page * PAGE_SIZE, data.total).toLocaleString()}`}
          </span>
        )}
      </div>
      <form className="filters" onSubmit={apply}>
        <div className="segmented">
          <button type="button" className={draft.mode === 'single' ? 'active' : ''} onClick={() => setDraft({ ...draft, mode: 'single' })}>Single date</button>
          <button type="button" className={draft.mode === 'range' ? 'active' : ''} onClick={() => setDraft({ ...draft, mode: 'range' })}>Date range</button>
        </div>
        {draft.mode === 'single' ? (
          <label>Date (UTC)<input type="date" value={draft.date} min={minDay} max={maxDay} onChange={set('date')} /></label>
        ) : (
          <>
            <label>From<input type="date" value={draft.from} min={minDay} max={maxDay} onChange={set('from')} /></label>
            <label>To<input type="date" value={draft.to} min={minDay} max={maxDay} onChange={set('to')} /></label>
          </>
        )}
        <label>Service
          <select value={draft.service_id} onChange={set('service_id')}>
            <option value="">All</option>
            {stats.services.map((s) => <option key={s.service_id} value={s.service_id}>{s.service_name}</option>)}
          </select>
        </label>
        <label>Status
          <select value={draft.status} onChange={set('status')}>
            <option value="">All</option><option value="up">Up (2xx)</option><option value="down">Down</option>
          </select>
        </label>
        <div className="filter-actions">
          <button type="submit" className="primary">Apply</button>
          <button type="button" onClick={clear}>Reset</button>
        </div>
      </form>

      {error && <div className="alert error">{error}</div>}

      {data && (
        <>
          <ActiveFilters applied={applied} services={stats.services} onClear={clear} />
          <div className="table-wrap logs-table">
            <table>
              <thead>
                <tr><th>Time (UTC)</th><th>Service</th><th>Status</th><th className="num">Latency</th><th className="col-hide">Agent</th><th className="col-hide">Region</th><th className="col-hide">Cleaning notes</th></tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className={r.is_up ? '' : 'row-down'}>
                    <td className="mono">{fmtUtc(r.ts).slice(0, 16)}</td>
                    <td>{r.service_name}</td>
                    <td><span className={`status-badge ${r.is_up ? 'good' : 'critical'}`}><span aria-hidden>{r.is_up ? '✓' : '✕'}</span>{r.status_code}</span></td>
                    <td className="num">{r.latency_ms == null ? '—' : `${Math.round(r.latency_ms)} ms`}</td>
                    <td className="col-hide">{r.agent}</td>
                    <td className="col-hide">{r.region}</td>
                    <td className="col-hide">{r.flags.map((f) => <span key={f} className="flag">{f.replace(/_/g, ' ')}</span>)}</td>
                  </tr>
                ))}
                {data.items.length === 0 && <tr><td colSpan={7} className="muted">No records match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            <span>Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        </>
      )}
    </section>
  )
}

function ActiveFilters({ applied, services, onClear }) {
  const parts = []
  if (applied.mode === 'single' && applied.date) parts.push(applied.date)
  if (applied.mode === 'range' && (applied.from || applied.to)) parts.push(`${applied.from || 'start'} → ${applied.to || 'end'}`)
  if (applied.service_id) parts.push(services.find((s) => s.service_id === applied.service_id)?.service_name || applied.service_id)
  if (applied.status) parts.push(applied.status === 'up' ? 'Up only' : 'Down only')
  if (!parts.length) return null
  return (
    <div className="active-filters">
      <span className="muted small">Filtered by</span>
      {parts.map((p) => <span key={p} className="chip">{p}</span>)}
      <button className="link small" onClick={onClear}>Clear all</button>
    </div>
  )
}
