import { useState } from 'react'
import { api, fmtMin, fmtUtc, ISSUE_LABELS } from '../api.js'

export default function StatsSection({ stats, onFocus }) {
  const [open, setOpen] = useState(true)
  const [rejected, setRejected] = useState(null)
  const { summary, services, incidents, data_quality: dq, upload } = stats
  const outages = incidents.filter((i) => i.kind === 'outage')

  const toggleRejected = async () => {
    if (rejected) return setRejected(null)
    const res = await api.rejected(upload.id)
    setRejected(res.items)
  }

  return (
    <section className="card">
      <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`chevron ${open ? 'open' : ''}`}>▸</span>
        <h2>SLA stats</h2>
        <span className="muted small">
          {fmtUtc(stats.period_start).slice(0, 10)} → {fmtUtc(stats.period_end).slice(0, 10)} · {stats.period_days} days ·
          target {stats.sla_target_pct}%
        </span>
        <span className="spacer" />
        <span className={`pill ${summary.services_breaching ? 'bad' : 'ok'}`}>
          {summary.services_breaching}/{summary.services} services below SLA
        </span>
      </button>

      {open && (
        <div className="section-body">
          <div className="tiles">
            <Tile label="Services below 99.9%" value={`${summary.services_breaching} / ${summary.services}`} tone={summary.services_breaching ? 'bad' : 'ok'} />
            <Tile label="Total downtime" value={fmtMin(summary.total_downtime_min)} />
            <Tile label="Outages detected" value={summary.outages} tone={summary.outages ? 'bad' : 'ok'} />
            <Tile label="Checks analysed" value={summary.total_checks.toLocaleString()} />
            <Tile label="Rows rejected" value={upload.rejected_rows} />
          </div>

          <h3>Per service</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Service</th><th className="num">Uptime</th><th>SLA</th><th className="num">Credit</th>
                  <th className="num">Downtime</th><th className="num">Outages</th><th className="num">Blips</th>
                  <th className="num">Longest outage</th><th className="num">p50 / p95 latency</th>
                  <th className="num">Missing checks</th><th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.service_id}>
                    <td><strong>{s.service_name}</strong><div className="muted small">{s.service_id}</div></td>
                    <td className={`num ${s.sla_met ? 'ok' : 'bad'}`}><strong>{s.uptime_pct.toFixed(3)}%</strong></td>
                    <td><span className={`pill ${s.sla_met ? 'ok' : 'bad'}`}>{s.sla_met ? 'Met' : 'Breached'}</span></td>
                    <td className="num">{s.credit_pct}%</td>
                    <td className="num">{fmtMin(s.downtime_min)}</td>
                    <td className="num">{s.outages}</td>
                    <td className="num">{s.blips}</td>
                    <td className="num">{s.longest_outage_min ? fmtMin(s.longest_outage_min) : '-'}</td>
                    <td className="num">{s.latency_p50_ms} / {s.latency_p95_ms} ms</td>
                    <td className="num">{s.missing_slots}</td>
                    <td className="small">{Object.entries(s.errors_by_code).map(([c, n]) => `${c}×${n}`).join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Outages <span className="muted small">(click one to see its checks in the logs below)</span></h3>
          {outages.length === 0 ? (
            <p className="muted">No sustained outages, only isolated failed checks.</p>
          ) : (
            <ul className="outages">
              {outages.map((o) => (
                <li key={o.service_id + o.start}>
                  <button className="link" onClick={() => onFocus({ date: o.start.slice(0, 10), service_id: o.service_id })}>
                    <strong>{o.service_name}</strong> · {fmtUtc(o.start)} → {fmtUtc(o.end).slice(11)} · {fmtMin(o.duration_min)} ·{' '}
                    {o.failed_checks} failed checks ({o.status_codes.join(', ')})
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3>Data quality</h3>
          <ul className="issues">
            {Object.entries(dq).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k}><span>{ISSUE_LABELS[k] || k}</span><strong>{v.toLocaleString()}</strong></li>
            ))}
          </ul>
          <button className="link" onClick={toggleRejected}>{rejected ? 'Hide' : 'Show'} rejected rows</button>
          {rejected && (
            <div className="table-wrap">
              <table>
                <thead><tr><th className="num">Line</th><th>Reason</th><th>Raw row</th></tr></thead>
                <tbody>
                  {rejected.map((r) => (
                    <tr key={r.line}><td className="num">{r.line}</td><td>{r.reason}</td><td className="mono small">{r.raw}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Tile({ label, value, tone }) {
  return (
    <div className="tile">
      <span className="label">{label}</span>
      <span className={`value ${tone || ''}`}>{value}</span>
    </div>
  )
}
