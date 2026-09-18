import { useState } from 'react'
import { api, fmtMin, fmtUtc, ISSUE_LABELS } from '../api.js'

const BAR_MIN = 95
const barPct = (u) => Math.max(0, Math.min(100, ((u - BAR_MIN) / (100 - BAR_MIN)) * 100))

function dayState(d) {
  if (!d.observed) return { key: 'nodata', label: 'No data' }
  if (d.outage) return { key: 'critical', label: 'Outage' }
  if (d.down >= 3) return { key: 'serious', label: `${d.down} failed checks` }
  if (d.down > 0) return { key: 'warning', label: `${d.down} failed check${d.down > 1 ? 's' : ''}` }
  return { key: 'good', label: 'All checks passed' }
}

const DROPPED = new Set([
  'exact_duplicate', 'duplicate_after_normalisation', 'invalid_status_code', 'invalid_timestamp',
  'timestamp_off_15min_schedule', 'malformed_row', 'missing_service_id',
])

export default function StatsSection({ stats, onFocus }) {
  const [open, setOpen] = useState(true)
  const [showTable, setShowTable] = useState(false)
  const [rejected, setRejected] = useState(null)
  const { summary, services, incidents, data_quality: dq, upload } = stats
  const outages = incidents.filter((i) => i.kind === 'outage')
  const dqEntries = Object.entries(dq).sort((a, b) => b[1] - a[1])

  const toggleRejected = async () => {
    if (rejected) return setRejected(null)
    setRejected((await api.rejected(upload.id)).items)
  }

  return (
    <section className="card">
      <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`chevron ${open ? 'open' : ''}`} aria-hidden>›</span>
        <span className="section-title">
          <h2>SLA overview</h2>
          <span className="muted small">
            {fmtUtc(stats.period_start).slice(0, 10)} → {fmtUtc(stats.period_end).slice(0, 10)} · {stats.period_days} days
            · target {stats.sla_target_pct}%
          </span>
        </span>
        <span className="spacer" />
        <span className={`status-badge ${summary.services_breaching ? 'critical' : 'good'}`}>
          <span aria-hidden>{summary.services_breaching ? '✕' : '✓'}</span>
          {summary.services_breaching}/{summary.services} below SLA
        </span>
        <span className="toggle-hint muted small">{open ? 'Collapse' : 'Expand'}</span>
      </button>

      {open && (
        <div className="section-body">
          <div className="kpis">
            <Kpi label="Services below 99.9%" value={`${summary.services_breaching}/${summary.services}`} tone={summary.services_breaching ? 'critical' : 'good'} />
            <Kpi label="Total downtime" value={fmtMin(summary.total_downtime_min)} sub="sum of failed 15-min checks" />
            <Kpi label="Outages detected" value={summary.outages} tone={summary.outages ? 'critical' : 'good'} sub="sustained incidents" />
            <Kpi label="Checks analysed" value={summary.total_checks.toLocaleString()} sub={`${upload.rejected_rows} rows rejected`} />
          </div>

          <div className="block-head">
            <h3>Service health</h3>
            <div className="legend" aria-label="Daily health legend">
              {[['good', 'Healthy'], ['warning', '1–2 failures'], ['serious', '3+ failures'], ['critical', 'Outage']].map(([k, l]) => (
                <span key={k}><i className={`dot ${k}`} />{l}</span>
              ))}
            </div>
          </div>
          <div className="services">
            {services.map((s) => (
              <article key={s.service_id} className={`svc ${s.sla_met ? '' : 'breached'}`}>
                <header>
                  <div>
                    <strong>{s.service_name}</strong>
                    <div className="muted small">{s.service_id}</div>
                  </div>
                  <span className={`status-badge ${s.sla_met ? 'good' : 'critical'}`}>
                    <span aria-hidden>{s.sla_met ? '✓' : '✕'}</span>{s.sla_met ? 'SLA met' : 'Breached'}
                  </span>
                </header>

                <div className="uptime">
                  <span className="uptime-value">{s.uptime_pct.toFixed(3)}<small>%</small></span>
                  <span className="muted small">uptime · credit <strong className="ink">{s.credit_pct}%</strong></span>
                </div>
                <div className="bar" role="img" aria-label={`Uptime ${s.uptime_pct}% against target 99.9%`}>
                  <div className="bar-fill" style={{ width: `${barPct(s.uptime_pct)}%` }} />
                  <div className="bar-target" style={{ left: `${barPct(99.9)}%` }} title="99.9% target" />
                </div>
                <div className="bar-scale muted"><span>{BAR_MIN}%</span><span>99.9 target</span></div>

                <dl className="svc-metrics">
                  <div><dt>Downtime</dt><dd>{fmtMin(s.downtime_min)}</dd></div>
                  <div><dt>Outages</dt><dd>{s.outages}</dd></div>
                  <div><dt>Blips</dt><dd>{s.blips}</dd></div>
                  <div><dt>p95</dt><dd>{Math.round(s.latency_p95_ms)} ms</dd></div>
                </dl>

                <div
                  className="days"
                  style={{ gridTemplateColumns: `repeat(${Math.min(s.daily.length, 15)}, 1fr)` }}
                  aria-label="Daily health, click a day to see its logs"
                >
                  {s.daily.map((d) => {
                    const st = dayState(d)
                    const tip = `${d.date} · ${st.label}${d.uptime_pct != null ? ` · ${d.uptime_pct}% up` : ''}`
                    return (
                      <button
                        key={d.date}
                        className={`day ${st.key}`}
                        data-tip={tip}
                        aria-label={tip}
                        onClick={() => onFocus({ date: d.date, service_id: s.service_id })}
                      />
                    )
                  })}
                </div>
              </article>
            ))}
          </div>

          <div className="block-head">
            <h3>Outages</h3>
            <span className="muted small">Click to open its checks in the logs</span>
          </div>
          {outages.length === 0 ? (
            <p className="muted">No sustained outages — only isolated failed checks.</p>
          ) : (
            <div className="outages">
              {outages.map((o) => (
                <button key={o.service_id + o.start} className="outage" onClick={() => onFocus({ date: o.start.slice(0, 10), service_id: o.service_id })}>
                  <span className="outage-icon" aria-hidden>!</span>
                  <span className="outage-main">
                    <strong>{o.service_name}</strong>
                    <span className="muted small">{fmtUtc(o.start)} → {fmtUtc(o.end).slice(11)}</span>
                  </span>
                  <span className="outage-meta">
                    <strong>{fmtMin(o.duration_min)}</strong>
                    <span className="muted small">{o.failed_checks} failed · {o.status_codes.join(', ')}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="block-head">
            <h3>Data quality</h3>
            <button className="link small" onClick={toggleRejected}>{rejected ? 'Hide' : 'Show'} rejected rows</button>
          </div>
          <div className="dq">
            <div>
              <h4>Dropped</h4>
              <ul className="issues">
                {dqEntries.filter(([k]) => DROPPED.has(k)).map(([k, v]) => (
                  <li key={k}><span>{ISSUE_LABELS[k] || k}</span><strong>{v.toLocaleString()}</strong></li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Fixed &amp; kept</h4>
              <ul className="issues">
                {dqEntries.filter(([k]) => !DROPPED.has(k)).map(([k, v]) => (
                  <li key={k}><span>{ISSUE_LABELS[k] || k}</span><strong>{v.toLocaleString()}</strong></li>
                ))}
              </ul>
            </div>
          </div>
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

          <button className="link small table-toggle" onClick={() => setShowTable(!showTable)}>
            {showTable ? 'Hide' : 'Show'} detailed per-service table
          </button>
          {showTable && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Service</th><th className="num">Uptime</th><th>SLA</th><th className="num">Credit</th>
                    <th className="num">Downtime</th><th className="num">Outages</th><th className="num">Blips</th>
                    <th className="num">Longest outage</th><th className="num">p50 / p95 / p99</th>
                    <th className="num">Missing checks</th><th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((s) => (
                    <tr key={s.service_id}>
                      <td><strong>{s.service_name}</strong></td>
                      <td className="num">{s.uptime_pct.toFixed(3)}%</td>
                      <td><span className={`status-badge ${s.sla_met ? 'good' : 'critical'}`}>{s.sla_met ? '✓ Met' : '✕ Breached'}</span></td>
                      <td className="num">{s.credit_pct}%</td>
                      <td className="num">{fmtMin(s.downtime_min)}</td>
                      <td className="num">{s.outages}</td>
                      <td className="num">{s.blips}</td>
                      <td className="num">{s.longest_outage_min ? fmtMin(s.longest_outage_min) : '–'}</td>
                      <td className="num">{Math.round(s.latency_p50_ms)} / {Math.round(s.latency_p95_ms)} / {Math.round(s.latency_p99_ms)} ms</td>
                      <td className="num">{s.missing_slots}</td>
                      <td className="small">{Object.entries(s.errors_by_code).map(([c, n]) => `${c}×${n}`).join(', ') || '–'}</td>
                    </tr>
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

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  )
}
