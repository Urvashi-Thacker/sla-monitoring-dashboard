# SLA Monitoring Dashboard

Upload a CSV of service health checks, then a serverless cloud function cleans it and saves it to Postgres. A one-page dashboard shows the SLA stats and the underlying logs.

**Live URL:** https://sla-monitoring-dashboard-murex.vercel.app (last verified live: 2026-09-18)

---

## 1. Architecture

```
 Browser (React SPA)                 Vercel Function (Python, AWS Lambda)          Supabase
 ───────────────────                 ────────────────────────────────────          ────────
 /upload  ── POST raw CSV ─────────▶ /api/upload  parse → validate → clean ──────▶ Postgres
                                                  bulk insert (1 transaction)       uploads
 /dashboard ── GET ────────────────▶ /api/stats   read checks → compute SLA ◀──────  checks
                                     /api/logs    date / range filter, paginated     rejected_rows
                                     /api/rejected, /api/uploads
```

| Piece | Choice | Why |
|---|---|---|
| Frontend | React + Vite, hosted on Vercel's CDN | Small SPA with two routes. Served from the same domain as the API, so no CORS setup. |
| Processing | **Vercel Serverless Function (Python / FastAPI)**, which runs on AWS Lambda | It's a real deployed, stateless cloud function and free with no credit card. I chose Python so the cleaning logic is plain, testable code. AWS/GCP/Azure were skipped because signing up needs a credit card. Cloudflare Workers were skipped because the free tier's 10 ms CPU limit per request is too small to parse a 1 MB CSV. |
| Database | **Supabase Postgres** (free tier) | Real SQL, indexed date-range queries, and it keeps data after the upload finishes. The function connects through Supabase's transaction pooler, which suits short-lived serverless connections. |

**Stateless:** each request opens its own DB connection and closes it when done, and nothing is kept in memory between requests. Stats are recomputed from the stored rows on every request, so the database is the only source of truth.

**Why stats are computed in Python and not SQL:** the slot-merging and outage-detection rules live in one module (`api/_lib/stats.py`). That module is used by the API and also by the offline verification script, so there is exactly one implementation to test and defend.

### Repo layout
```
api/index.py            FastAPI app = the serverless function (all /api routes)
api/_lib/cleaning.py    CSV → validated, cleaned rows (pure functions)
api/_lib/stats.py       cleaned rows → SLA stats + outage detection (pure functions)
db/schema.sql           tables: uploads, checks, rejected_rows
scripts/verify_pipeline.py  runs cleaning+stats on all CSVs and checks them against the incident log
src/                    React app (UploadPage, DashboardPage, StatsSection, LogsSection)
vercel.json             routes /api/* to the function, everything else to the SPA
```

---

## 2. Data findings

I profiled all 5 files (9, 12, 14, 21 and 30 days). **Every file has the same set of problems.** Each fix is recorded, either as a `flag` on the stored row or as a `reason` on a rejected row, so nothing is dropped silently. The dashboard shows the counts, and every rejected row can be viewed.

| # | Issue found | Example | Handling |
|---|---|---|---|
| 1 | **Three timestamp formats** in one file | `2025-05-13T12:45:00Z`, `2025-05-09T20:00:00+05:30`, `1746938700` | All converted to UTC. The `+05:30` (IST) rows are correct once converted: they land on the same 15-minute grid. Flag: `ts_offset_converted` / `ts_epoch_converted`. |
| 2 | **Same check re-sent in a different time format** | `20:00+05:30` from agent-1 = an existing `14:30Z` row from agent-1 | Only visible after converting to UTC. Rejected as `duplicate_after_normalisation`; the first copy is kept. |
| 3 | **Exact duplicate rows** | 6–24 per file | Rejected as `exact_duplicate` |
| 4 | **Mixed latency units** | `search-api` always reports seconds (`0.717`, unit `s`), all other services report ms | Converted to ms. Flag: `latency_seconds_converted` |
| 5 | **Missing latency** | ~1.2% of rows are blank | The row is **kept**, because its status code is still a valid availability signal. Latency is stored as null and left out of the percentiles. Flag: `missing_latency` |
| 6 | **Negative latency** | `-286 ms`, one per file | Physically impossible, so latency is set to null and the row is kept. Flag: `negative_latency` |
| 7 | **Invalid HTTP status** `999` | One per file | Not a real HTTP code, so we can't tell whether the service was up. Rejected as `invalid_status_code`. If no other agent covered that slot, it becomes a *missing* slot, which counts neither as up nor as down. In the 14-day file, agent-2 reported `200` for that same slot, so the slot is still covered. |
| 8 | **Two agents report the same slot** | ~8% of slots have agent-1 **and** agent-2 | Both rows are kept, because they're real observations. For uptime they are merged into one slot (see assumptions). In this data the two agents never disagreed on a valid status. |
| 9 | **Outages "flap"** | Inside a logged outage some checks still return 200, but every check has latency 3–5× normal | Outage detection is based on latency degradation, not only on runs of consecutive failures (see §3) |
| 10 | **Background failures** | Isolated 500/502/503s spread across all services, with normal latency | Counted as downtime for the SLA, and labelled *blips*, not outages |

Checked and **not** found (the code still handles them): unparseable timestamps, timestamps off the 15-minute schedule, rows outside the file's range, service_id/service_name mismatches, malformed rows, and leading/trailing whitespace. Apart from the rejected rows, every file has full coverage: 96 slots per day per service.

**Verification:** `python scripts/verify_pipeline.py <folder>` runs the same code the function uses on all 5 files. It detects **all 8 incidents** listed in `dataset_incident_log.json`, with exact start and end times, and finds **no extra outages**.

---

## 3. Assumptions and decisions

- **Unit of measurement = the slot:** one service at one 15-minute check time. Uptime is `up slots ÷ observed slots`.
- **Merging multiple agents:** a slot is **down only if every agent that reported it saw a failure**. If any agent got a 2xx, the service was reachable, so the failure is treated as an agent or network problem. This avoids double counting and makes one flaky agent less able to trigger a billing credit.
- **"Up" means a 2xx status.** 5xx counts as down. Codes outside 100–599 are invalid (rejected).
- **Missing slots** (no valid report) are **excluded** from uptime and shown in their own column, not counted as downtime. Charging the provider for our own monitoring gaps would be wrong. The opposite (customer-friendly) policy would be a one-line change.
- **SLA period = the period the data covers**, not a calendar month. The spec says the range varies, so the period is taken from the data (first slot → last slot + 15 min).
- **Credit tiers** (the spec only gives 99.9%), modelled on common cloud SLAs: below 99.9% → 10%, below 99.0% → 25%, below 95.0% → 100%.
- **Outage detection:** a slot is *degraded* if its latency is more than 2× that service's median. **3 or more consecutive degraded slots (≥ 45 min) is an outage.** A slot with no latency can bridge a run but can't start one. Failed checks outside outages are *blips*. Outages are for explaining what happened; **the SLA number always comes from status codes alone.**
- **Dates in the log filter are UTC calendar days**, and a range is inclusive on both ends. Monitoring and SLA periods are in UTC, and the UI labels times as UTC everywhere.
- **Each upload is a separate dataset** (`upload_id`). The dashboard shows the latest one by default and lets you switch. Nothing is overwritten.
- **Uploading the same file again does not create a duplicate.** The function takes a SHA-256 fingerprint of the file contents (`uploads.file_hash`, unique). If that exact file already exists, it returns the existing dataset and the UI says so. A file with *any* change has a different fingerprint and is stored as a new dataset, because it is different data. The unique constraint plus `on conflict do nothing` also covers two identical uploads arriving at the same moment.
- **Latency percentiles** use successful checks only, since failed requests' latency describes the error path.

### Stats chosen, and why
The two audiences are **on-call engineers** ("what broke, when, for how long") and **billing** ("who breached, what credit").

- **Header:** how many services are below 99.9%, total downtime, outages detected, checks analysed, rows rejected
- **Service health cards:** one per service, showing uptime % on a 95–100% bar with the 99.9% target marked, met or breached, credit %, downtime, outages, blips and p95 latency
- **Daily health strip** on each card: one cell per UTC day (healthy / 1–2 failures / 3+ failures / outage). Hover a cell for details; click it to open that day's logs. You can see *when* things went wrong without reading a table.
- **Detailed table** (can be expanded) for billing: all of the above plus p50/p99 latency, missing checks and an error breakdown by status code
- **Outage list:** click one to jump the log view to that service and day
- **Data quality:** what cleaning changed, plus the rejected rows. If the number decides a billing credit, reviewers need to see what was thrown away.

---

## 4. Running and deploying

### Deploy (what the live URL uses)
1. **Supabase:** create a free project. In **SQL Editor**, run `db/schema.sql`. Then copy the connection string from **Connect → Transaction pooler** (port 6543).
2. **Vercel:** click **Add New → Project**, import this GitHub repo (it detects the Vite framework), then under **Environment Variables** add `DATABASE_URL` = the pooler string, and click **Deploy**.
3. Every push to `main` redeploys automatically.

*Free-tier note:* Supabase pauses a free project after about 7 days without activity. If the live URL shows a DB error, open the Supabase dashboard and click **Restore project**. No redeploy is needed.

### Run locally
```bash
# backend
python -m venv .venv && .venv\Scripts\activate          # Windows (use source .venv/bin/activate on mac/linux)
pip install -r requirements.txt uvicorn
set DATABASE_URL=postgresql://...                        # PowerShell: $env:DATABASE_URL="..."
uvicorn api.index:app --port 8000

# frontend (second terminal) – Vite proxies /api to :8000
npm install
npm run dev

# verify the pipeline against the incident log (no DB needed)
python scripts/verify_pipeline.py "path/to/folder/with/csvs"
```

---

## 5. What I'd do with more time
- **Uploads larger than Vercel's 4.5 MB body limit:** upload straight from the browser to object storage with a pre-signed URL, and have that trigger the function. Stream-parse instead of loading the whole file into memory.
- **Move the slot-merging and stats into SQL views or materialised tables** so they scale beyond ~100k rows. At the current size, Python finishes in milliseconds.
- **Unit tests** for each cleaning rule (every issue in §2 as a fixture), and property tests for the timezone handling
- **Make the thresholds configurable:** outage factor, minimum duration, missing-slot policy and credit tiers, each set per service
- **Charts:** an uptime timeline per service with outages highlighted, and a latency heatmap
