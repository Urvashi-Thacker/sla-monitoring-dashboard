import hashlib
import os
import sys
from datetime import date, datetime, time, timedelta, timezone

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_lib"))
from cleaning import clean_csv
from stats import compute_stats

MAX_UPLOAD_BYTES = 4 * 1024 * 1024

app = FastAPI(title="SLA Monitoring API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(psycopg.OperationalError)
async def db_unavailable(_request: Request, exc: psycopg.OperationalError):
    return JSONResponse(status_code=503, content={"detail": f"Database connection failed: {exc}"})


@app.exception_handler(Exception)
async def unexpected(_request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"})


def db():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise HTTPException(500, "DATABASE_URL is not configured")
    return psycopg.connect(url, row_factory=dict_row, prepare_threshold=None, connect_timeout=10)


def resolve_upload(cur, upload_id: int | None) -> dict:
    if upload_id is None:
        cur.execute("select * from uploads order by id desc limit 1")
    else:
        cur.execute("select * from uploads where id = %s", (upload_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "No upload found. Upload a CSV first.")
    return row


@app.get("/api/health")
def health():
    return {"ok": True}


def duplicate_response(existing: dict) -> dict:
    return {
        "upload_id": existing["id"],
        "filename": existing["filename"],
        "total_rows": existing["total_rows"],
        "accepted_rows": existing["accepted_rows"],
        "rejected_rows": existing["rejected_rows"],
        "period_start": existing["period_start"],
        "period_end": existing["period_end"],
        "issues": existing["issues"],
        "duplicate": True,
    }


@app.post("/api/upload")
async def upload(request: Request, filename: str = Query("upload.csv")):
    body = await request.body()
    if not body:
        raise HTTPException(400, "Empty request body")
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File larger than 4 MB")
    try:
        text = body.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "File is not UTF-8 text")
    try:
        res = clean_csv(text)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not res.accepted:
        raise HTTPException(400, "No valid rows found in file")

    file_hash = hashlib.sha256(body).hexdigest()
    a = res.accepted
    with db() as conn, conn.cursor() as cur:
        cur.execute("select * from uploads where file_hash = %s", (file_hash,))
        existing = cur.fetchone()
        if existing:
            return duplicate_response(existing)

        cur.execute(
            """insert into uploads (filename, file_hash, total_rows, accepted_rows, rejected_rows,
                                    period_start, period_end, issues)
               values (%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (file_hash) do nothing
               returning id""",
            (filename, file_hash, res.total_rows, len(a), len(res.rejected),
             res.period_start, res.period_end, Jsonb(dict(res.issues))),
        )
        inserted = cur.fetchone()
        if inserted is None:
            cur.execute("select * from uploads where file_hash = %s", (file_hash,))
            return duplicate_response(cur.fetchone())
        upload_id = inserted["id"]

        cur.execute(
            """insert into checks (upload_id, service_id, service_name, ts, status_code, is_up,
                                   latency_ms, agent, region, flags, source_line)
               select %s, s, n, t, c, u, l, ag, rg,
                      coalesce(string_to_array(nullif(f, ''), ','), '{}'), ln
               from unnest(%s::text[], %s::text[], %s::timestamptz[], %s::smallint[], %s::bool[],
                           %s::real[], %s::text[], %s::text[], %s::text[], %s::int[])
                    as x(s, n, t, c, u, l, ag, rg, f, ln)""",
            (upload_id,
             [r["service_id"] for r in a], [r["service_name"] for r in a], [r["ts"] for r in a],
             [r["status_code"] for r in a], [r["is_up"] for r in a], [r["latency_ms"] for r in a],
             [r["agent"] for r in a], [r["region"] for r in a], [",".join(r["flags"]) for r in a],
             [r["source_line"] for r in a]),
        )
        if res.rejected:
            cur.execute(
                """insert into rejected_rows (upload_id, line, raw, reason)
                   select %s, l, r, why from unnest(%s::int[], %s::text[], %s::text[]) as x(l, r, why)""",
                (upload_id, [r["line"] for r in res.rejected], [r["raw"] for r in res.rejected],
                 [r["reason"] for r in res.rejected]),
            )

    return {
        "upload_id": upload_id,
        "filename": filename,
        "total_rows": res.total_rows,
        "accepted_rows": len(a),
        "rejected_rows": len(res.rejected),
        "period_start": res.period_start,
        "period_end": res.period_end,
        "issues": dict(res.issues),
        "duplicate": False,
    }


@app.get("/api/uploads")
def list_uploads():
    with db() as conn, conn.cursor() as cur:
        cur.execute("""select id, filename, uploaded_at, total_rows, accepted_rows, rejected_rows,
                              period_start, period_end from uploads order by id desc limit 50""")
        return cur.fetchall()


@app.get("/api/stats")
def stats(upload_id: int | None = None):
    with db() as conn, conn.cursor() as cur:
        up = resolve_upload(cur, upload_id)
        cur.execute("""select service_id, service_name, ts, status_code, is_up, latency_ms
                       from checks where upload_id = %s""", (up["id"],))
        rows = cur.fetchall()
    result = compute_stats(rows, up["period_start"], up["period_end"])
    result["upload"] = {k: up[k] for k in ("id", "filename", "uploaded_at", "total_rows",
                                           "accepted_rows", "rejected_rows")}
    result["data_quality"] = up["issues"]
    return result


def parse_day(value: str, name: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, f"{name} must be YYYY-MM-DD")


@app.get("/api/logs")
def logs(
    upload_id: int | None = None,
    date_: str | None = Query(None, alias="date", description="single day, YYYY-MM-DD (UTC)"),
    from_: str | None = Query(None, alias="from", description="range start, inclusive"),
    to: str | None = Query(None, description="range end, inclusive"),
    service_id: str | None = None,
    status: str | None = Query(None, pattern="^(up|down)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
):
    if date_ and (from_ or to):
        raise HTTPException(400, "Use either date OR from/to, not both")
    if date_:
        from_ = to = date_
    start = datetime.combine(parse_day(from_, "from"), time.min, timezone.utc) if from_ else None
    end = datetime.combine(parse_day(to, "to") + timedelta(days=1), time.min, timezone.utc) if to else None
    if start and end and start >= end:
        raise HTTPException(400, "'from' must be on or before 'to'")

    where, params = ["upload_id = %s"], []
    with db() as conn, conn.cursor() as cur:
        up = resolve_upload(cur, upload_id)
        params.append(up["id"])
        if start:
            where.append("ts >= %s"); params.append(start)
        if end:
            where.append("ts < %s"); params.append(end)
        if service_id:
            where.append("service_id = %s"); params.append(service_id)
        if status:
            where.append("is_up = %s"); params.append(status == "up")
        clause = " and ".join(where)

        cur.execute(f"select count(*) as n from checks where {clause}", params)
        total = cur.fetchone()["n"]
        cur.execute(
            f"""select id, service_id, service_name, ts, status_code, is_up, latency_ms,
                       agent, region, flags, source_line
                from checks where {clause}
                order by ts, service_id, agent
                limit %s offset %s""",
            params + [page_size, (page - 1) * page_size],
        )
        items = cur.fetchall()
    return {"upload_id": up["id"], "total": total, "page": page, "page_size": page_size, "items": items}


@app.get("/api/rejected")
def rejected(upload_id: int | None = None):
    with db() as conn, conn.cursor() as cur:
        up = resolve_upload(cur, upload_id)
        cur.execute("select line, raw, reason from rejected_rows where upload_id = %s order by line",
                    (up["id"],))
        return {"upload_id": up["id"], "items": cur.fetchall()}
