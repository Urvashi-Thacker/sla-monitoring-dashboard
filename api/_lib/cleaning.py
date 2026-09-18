from __future__ import annotations

import csv
import io
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

REQUIRED_COLUMNS = [
    "service_id", "service_name", "timestamp", "status_code",
    "latency", "latency_unit", "agent", "region",
]
CHECK_INTERVAL = timedelta(minutes=15)


@dataclass
class CleanResult:
    accepted: list[dict] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)
    issues: Counter = field(default_factory=Counter)
    total_rows: int = 0
    period_start: datetime | None = None
    period_end: datetime | None = None


def parse_timestamp(raw: str) -> tuple[datetime | None, str | None]:
    raw = raw.strip()
    if not raw:
        return None, None
    if raw.isdigit():
        return datetime.fromtimestamp(int(raw), tz=timezone.utc), "ts_epoch_converted"
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None, None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc), "ts_naive_assumed_utc"
    flag = None if dt.utcoffset() == timedelta(0) else "ts_offset_converted"
    return dt.astimezone(timezone.utc), flag


def parse_status(raw: str) -> int | None:
    raw = raw.strip()
    if not raw.isdigit():
        return None
    code = int(raw)
    return code if 100 <= code <= 599 else None


def parse_latency(raw: str, unit: str) -> tuple[float | None, str | None]:
    raw, unit = raw.strip(), unit.strip().lower()
    if raw == "":
        return None, "missing_latency"
    try:
        value = float(raw)
    except ValueError:
        return None, "invalid_latency"
    if value < 0:
        return None, "negative_latency"
    if unit == "ms":
        return value, None
    if unit == "s":
        return round(value * 1000, 3), "latency_seconds_converted"
    return None, "unknown_latency_unit"


def clean_csv(text: str) -> CleanResult:
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))
    try:
        header = [h.strip().lower() for h in next(reader)]
    except StopIteration:
        raise ValueError("File is empty")
    missing = [c for c in REQUIRED_COLUMNS if c not in header]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")
    idx = {c: header.index(c) for c in REQUIRED_COLUMNS}

    res = CleanResult()
    seen_raw: set[tuple] = set()
    seen_key: set[tuple] = set()
    service_names: dict[str, str] = {}

    def reject(line_no: int, raw: list[str], reason: str) -> None:
        res.rejected.append({"line": line_no, "raw": ",".join(raw), "reason": reason})
        res.issues[reason] += 1

    for line_no, raw in enumerate(reader, start=2):
        if not raw or all(not c.strip() for c in raw):
            continue
        res.total_rows += 1

        if len(raw) != len(header):
            reject(line_no, raw, "malformed_row")
            continue

        raw_key = tuple(c.strip() for c in raw)
        if raw_key in seen_raw:
            reject(line_no, raw, "exact_duplicate")
            continue
        seen_raw.add(raw_key)

        get = lambda c: raw[idx[c]].strip()
        flags: list[str] = []

        service_id = get("service_id")
        if not service_id:
            reject(line_no, raw, "missing_service_id")
            continue

        ts, ts_flag = parse_timestamp(get("timestamp"))
        if ts is None:
            reject(line_no, raw, "invalid_timestamp")
            continue
        if ts_flag:
            flags.append(ts_flag)
        if ts.minute % 15 or ts.second or ts.microsecond:
            reject(line_no, raw, "timestamp_off_15min_schedule")
            continue

        status = parse_status(get("status_code"))
        if status is None:
            reject(line_no, raw, "invalid_status_code")
            continue

        agent = get("agent") or "unknown"
        key = (service_id, ts, agent)
        if key in seen_key:
            reject(line_no, raw, "duplicate_after_normalisation")
            continue
        seen_key.add(key)

        latency_ms, lat_flag = parse_latency(get("latency"), get("latency_unit"))
        if lat_flag:
            flags.append(lat_flag)

        name = get("service_name")
        known = service_names.setdefault(service_id, name)
        if name != known:
            flags.append("service_name_mismatch")
            name = known

        for f in flags:
            res.issues[f] += 1

        res.accepted.append({
            "service_id": service_id,
            "service_name": name,
            "ts": ts,
            "status_code": status,
            "is_up": 200 <= status <= 299,
            "latency_ms": latency_ms,
            "agent": agent,
            "region": get("region") or None,
            "flags": flags,
            "source_line": line_no,
        })

    if res.accepted:
        res.period_start = min(r["ts"] for r in res.accepted)
        res.period_end = max(r["ts"] for r in res.accepted) + CHECK_INTERVAL

    per_slot = Counter((r["service_id"], r["ts"]) for r in res.accepted)
    multi = sum(1 for n in per_slot.values() if n > 1)
    if multi:
        res.issues["slots_reported_by_multiple_agents"] = multi

    return res
