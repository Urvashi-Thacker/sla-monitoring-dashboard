"""
Run the same cleaning + stats code the cloud function uses against every CSV in
a folder, and compare detected outages with dataset_incident_log.json.

Usage:  python scripts/verify_pipeline.py <folder with csvs + dataset_incident_log.json>
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api" / "_lib"))
from cleaning import clean_csv
from stats import compute_stats

folder = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
log = json.loads((folder / "dataset_incident_log.json").read_text())
all_ok = True

for csv_path in sorted(folder.glob("*.csv")):
    res = clean_csv(csv_path.read_text())
    st = compute_stats(res.accepted, res.period_start, res.period_end)
    meta = log.get(csv_path.name, {})
    print(f"\n=== {csv_path.name}  rows={res.total_rows} accepted={len(res.accepted)} "
          f"rejected={len(res.rejected)}  period={st['period_days']}d from {st['period_start'][:10]}")
    print("  issues:", dict(res.issues))
    for s in st["services"]:
        print(f"  {s['service_id']:<13} uptime={s['uptime_pct']:>7}%  down={s['down_slots']:>3} "
              f"outages={s['outages']} blips={s['blips']} missing={s['missing_slots']} "
              f"p95={s['latency_p95_ms']}ms credit={s['credit_pct']}%")

    detected = {(i["service_id"], i["start"], i["end"]) for i in st["incidents"] if i["kind"] == "outage"}
    start = datetime.fromisoformat(meta["start"]).replace(tzinfo=timezone.utc)
    for label, window in meta.get("incidents", {}).items():
        svc, day = re.match(r"(\S+) day (\d+)", label).groups()
        a, b = map(int, re.match(r"check-points (\d+)-(\d+)", window).groups())
        exp_start = start + timedelta(days=int(day), minutes=15 * a)
        exp_end = start + timedelta(days=int(day), minutes=15 * (b + 1))
        hit = (svc, exp_start.isoformat(), exp_end.isoformat()) in detected
        all_ok &= hit
        print(f"  expected {label} {exp_start:%Y-%m-%d %H:%M}-{exp_end:%H:%M}: {'MATCH' if hit else 'NOT FOUND'}")
    extra = [d for d in detected if not any(d[0] in k for k in meta.get("incidents", {}))]
    if extra:
        print("  other outages detected:", sorted(extra))

print("\nALL LOGGED INCIDENTS DETECTED" if all_ok else "\nSOME INCIDENTS NOT MATCHED")
