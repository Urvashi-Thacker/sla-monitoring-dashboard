from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta

CHECK_INTERVAL = timedelta(minutes=15)
SLA_TARGET = 99.9

CREDIT_TIERS = [(95.0, 100), (99.0, 25), (99.9, 10)]


def credit_for(uptime: float | None) -> int:
    if uptime is None:
        return 0
    for threshold, pct in CREDIT_TIERS:
        if uptime < threshold:
            return pct
    return 0


def percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return round(sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo), 1)


def merge_slots(rows: list[dict]) -> dict[tuple, dict]:
    slots: dict[tuple, dict] = {}
    for r in rows:
        k = (r["service_id"], r["ts"])
        s = slots.setdefault(k, {"up": False, "codes": set(), "key": k})
        s["up"] = s["up"] or r["is_up"]
        s["codes"].add(r["status_code"])
    return slots


DEGRADED_FACTOR = 2.0
OUTAGE_MIN_SLOTS = 3


def detect_incidents(items: list, sorted_lat: list[float], slot_latency: dict) -> list[dict]:
    median = percentile(sorted_lat, 0.5) or 0

    def state(i: int) -> str:
        lat = slot_latency.get(items[i][1]["key"])
        if lat is None:
            return "unknown"
        return "degraded" if median and lat > DEGRADED_FACTOR * median else "normal"

    runs, cur = [], None
    for i in range(len(items)):
        st = state(i)
        if st == "degraded":
            if cur is None:
                cur = [i, i]
            else:
                cur[1] = i
        elif st == "normal" and cur is not None:
            runs.append(cur)
            cur = None
    if cur is not None:
        runs.append(cur)

    out, in_outage = [], set()
    for lo, hi in runs:
        if hi - lo + 1 < OUTAGE_MIN_SLOTS:
            continue
        window = range(lo, hi + 1)
        in_outage.update(window)
        failed = [i for i in window if not items[i][1]["up"]]
        out.append({
            "start": items[lo][0].isoformat(),
            "end": (items[hi][0] + CHECK_INTERVAL).isoformat(),
            "duration_min": (hi - lo + 1) * 15,
            "failed_checks": len(failed),
            "status_codes": sorted(set().union(*(items[i][1]["codes"] for i in failed))) if failed else [],
            "kind": "outage",
        })
    for i, (ts, s) in enumerate(items):
        if not s["up"] and i not in in_outage:
            out.append({
                "start": ts.isoformat(),
                "end": (ts + CHECK_INTERVAL).isoformat(),
                "duration_min": 15,
                "failed_checks": 1,
                "status_codes": sorted(s["codes"]),
                "kind": "blip",
            })
    return out


def compute_stats(rows: list[dict], period_start: datetime, period_end: datetime) -> dict:
    expected = int((period_end - period_start) / CHECK_INTERVAL)
    slots = merge_slots(rows)

    names: dict[str, str] = {}
    latencies: dict[str, list[float]] = defaultdict(list)
    errors: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        names[r["service_id"]] = r["service_name"]
        if r["latency_ms"] is not None and r["is_up"]:
            latencies[r["service_id"]].append(float(r["latency_ms"]))
        if not r["is_up"]:
            errors[r["service_id"]][str(r["status_code"])] += 1

    slot_latency: dict[tuple, float] = {}
    for r in rows:
        if r["latency_ms"] is not None:
            k = (r["service_id"], r["ts"])
            slot_latency[k] = max(slot_latency.get(k, 0.0), float(r["latency_ms"]))

    by_service: dict[str, list] = defaultdict(list)
    for (svc, ts), s in slots.items():
        by_service[svc].append((ts, s))

    services, incidents = [], []
    for svc in sorted(by_service):
        items = sorted(by_service[svc], key=lambda x: x[0])
        observed = len(items)
        down = [(ts, s) for ts, s in items if not s["up"]]
        uptime = round(100 * (observed - len(down)) / observed, 3) if observed else None

        days: dict[str, list[int]] = {}
        d = period_start
        while d < period_end:
            days[d.date().isoformat()] = [0, 0]
            d += timedelta(days=1)
        for ts, s in items:
            day = days.setdefault(ts.date().isoformat(), [0, 0])
            day[0] += 1
            day[1] += 0 if s["up"] else 1

        lat = sorted(latencies[svc])
        svc_incidents = detect_incidents(items, lat, slot_latency)
        for inc in svc_incidents:
            incidents.append({"service_id": svc, "service_name": names[svc], **inc})
        outages = [i for i in svc_incidents if i["kind"] == "outage"]

        services.append({
            "service_id": svc,
            "service_name": names[svc],
            "uptime_pct": uptime,
            "sla_met": uptime is not None and uptime >= SLA_TARGET,
            "credit_pct": credit_for(uptime),
            "expected_slots": expected,
            "observed_slots": observed,
            "missing_slots": max(expected - observed, 0),
            "down_slots": len(down),
            "downtime_min": len(down) * 15,
            "outages": len(outages),
            "blips": len(svc_incidents) - len(outages),
            "longest_outage_min": max((i["duration_min"] for i in outages), default=0),
            "latency_p50_ms": percentile(lat, 0.50),
            "latency_p95_ms": percentile(lat, 0.95),
            "latency_p99_ms": percentile(lat, 0.99),
            "errors_by_code": dict(errors[svc]),
            "daily": [
                {"date": k, "observed": v[0], "down": v[1],
                 "uptime_pct": round(100 * (v[0] - v[1]) / v[0], 2) if v[0] else None,
                 "outage": any(o["start"][:10] <= k <= o["end"][:10] for o in outages)}
                for k, v in sorted(days.items())
            ],
        })

    incidents.sort(key=lambda i: (i["kind"] != "outage", i["start"]))
    return {
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "period_days": round((period_end - period_start) / timedelta(days=1), 2),
        "sla_target_pct": SLA_TARGET,
        "summary": {
            "services": len(services),
            "services_breaching": sum(1 for s in services if not s["sla_met"]),
            "total_checks": len(rows),
            "total_downtime_min": sum(s["downtime_min"] for s in services),
            "outages": sum(1 for i in incidents if i["kind"] == "outage"),
            "worst_service": min(services, key=lambda s: s["uptime_pct"] or 0)["service_id"] if services else None,
        },
        "services": services,
        "incidents": incidents,
    }
