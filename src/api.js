async function request(path, options = {}) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.detail ? JSON.stringify(body.detail).replace(/^"|"$/g, '') : `HTTP ${res.status}`)
  return body
}

const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()

export const api = {
  upload: (file) =>
    request(`/api/upload?${qs({ filename: file.name })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: file, // raw file bytes; parsing happens in the cloud function
    }),
  uploads: () => request('/api/uploads'),
  stats: (uploadId) => request(`/api/stats?${qs({ upload_id: uploadId })}`),
  logs: (params) => request(`/api/logs?${qs(params)}`),
  rejected: (uploadId) => request(`/api/rejected?${qs({ upload_id: uploadId })}`),
}

export const fmtUtc = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '-')
export const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`)
export const ISSUE_LABELS = {
  exact_duplicate: 'Exact duplicate rows (dropped)',
  duplicate_after_normalisation: 'Same check re-sent in another time format (dropped)',
  invalid_status_code: 'Invalid HTTP status, e.g. 999 (dropped)',
  invalid_timestamp: 'Unparseable timestamp (dropped)',
  timestamp_off_15min_schedule: 'Timestamp off the 15-min schedule (dropped)',
  malformed_row: 'Malformed row (dropped)',
  missing_service_id: 'Missing service id (dropped)',
  ts_offset_converted: 'Timestamp with +05:30 offset, converted to UTC',
  ts_epoch_converted: 'Epoch-seconds timestamp, converted to UTC',
  ts_naive_assumed_utc: 'Timestamp without timezone, assumed UTC',
  latency_seconds_converted: 'Latency in seconds, converted to ms',
  missing_latency: 'Missing latency (kept, latency null)',
  negative_latency: 'Negative latency (kept, latency null)',
  invalid_latency: 'Non-numeric latency (kept, latency null)',
  unknown_latency_unit: 'Unknown latency unit (kept, latency null)',
  service_name_mismatch: 'Service name mismatch (normalised)',
  slots_reported_by_multiple_agents: 'Slots reported by 2 agents (merged for uptime)',
}
