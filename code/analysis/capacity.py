"""
Capacity finder: how many users can the target take before it breaks its SLO?

Instead of one fixed load, a capacity run climbs in steps: start_users for
step_duration_seconds, then start_users + step_users, and so on up to
max_users. Each step is judged against the run's SLO on its own. The answer:

    max sustainable users - the highest step that passed, with every lower
                            step passing too
    breaking point        - the first step that failed (or none within
                            max_users)

Where the numbers come from:
  * users, requests per second, p95 and average come from Locust's
    per-second history CSV (rows are assigned to steps by elapsed time);
  * failure categories per step (5xx, no answer, unexpected answers, 429)
    come from the step records written by locust_tests/step_shape.py, because
    the history CSV only has a total failure count.
The step shape uses the same snapshot / record / evaluate functions below at
run time to stop early after the first failing step.

All functions are pure (no Locust, no files).
"""
import csv
import io

from analysis.failure_summary import _meaning, _parse_error
from analysis.slo import evaluate_slo

MAX_USERS = 1000
MAX_TOTAL_SECONDS = 300
MAX_SPAWN_RATE = 20
MIN_STEP_SECONDS = 5

# Per-step judgement uses the thresholds that describe the target breaking.
# min_rps is left out: throughput is low at small steps by design.
STEP_SLO_KEYS = ("p95_ms", "avg_ms", "max_server_error_rate_pct", "max_unexpected_outcome_rate_pct")

# A step needs this share of its seconds in the history to count (a run
# stopped half-way through a step leaves a partial step that is ignored).
COMPLETE_SHARE = 0.75


# ---- plan -------------------------------------------------------------------------

def plan_steps(start_users, step_users, max_users):
    """[start, start + step, ...] up to and including max_users."""
    users, steps = start_users, []
    while users <= max_users:
        steps.append(users)
        users += step_users
    return steps


def _int(raw, key, low, high):
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        return None, f"capacity.{key} must be a whole number"
    if not low <= value <= high:
        return None, f"capacity.{key} must be between {low} and {high}"
    return value, None


def clean_capacity(raw):
    """
    Validates {start_users, step_users, step_duration_seconds, max_users,
    early_stop?} against the app's limits (users 1-1000, total duration
    <= 300 s). Returns (plan, error); plan adds "steps" and "total_seconds".
    """
    if not isinstance(raw, dict):
        return None, "capacity must be an object"
    start, err = _int(raw, "start_users", 1, MAX_USERS)
    if err:
        return None, err
    step, err = _int(raw, "step_users", 1, MAX_USERS)
    if err:
        return None, err
    seconds, err = _int(raw, "step_duration_seconds", MIN_STEP_SECONDS, MAX_TOTAL_SECONDS)
    if err:
        return None, err
    top, err = _int(raw, "max_users", 1, MAX_USERS)
    if err:
        return None, err
    if top < start:
        return None, "capacity.max_users must be at least start_users"
    early_stop = raw.get("early_stop", True)
    if not isinstance(early_stop, bool):
        return None, "capacity.early_stop must be true or false"
    steps = plan_steps(start, step, top)
    total = len(steps) * seconds
    if total > MAX_TOTAL_SECONDS:
        return None, (f"{len(steps)} steps x {seconds} s = {total} s; a capacity run may last at most "
                      f"{MAX_TOTAL_SECONDS} s (use fewer or shorter steps)")
    return {
        "start_users": start, "step_users": step, "step_duration_seconds": seconds,
        "max_users": top, "early_stop": early_stop, "steps": steps, "total_seconds": total,
    }, None


def ramp_problem(plan, spawn_rate):
    """A message when the spawn rate is too slow for the plan: reaching a
    step's users (the first step's start_users, then step_users more each
    time) must take at most half of the step, or the step is measured at a
    lower load than planned."""
    biggest_jump = max(plan["start_users"], plan["step_users"] if len(plan["steps"]) > 1 else 0)
    seconds = biggest_jump / spawn_rate
    if seconds > plan["step_duration_seconds"] / 2:
        need = -(-2 * biggest_jump // plan["step_duration_seconds"])  # ceiling
        return (f"spawn_rate {spawn_rate}/s needs {seconds:g} s to add {biggest_jump} users, more than half "
                f"of a {plan['step_duration_seconds']} s step; use a spawn rate of at least {need} "
                f"(max {MAX_SPAWN_RATE}) or longer steps")
    return None


def step_slo(slo):
    """The part of the run's SLO that is judged per step, or None."""
    picked = {k: v for k, v in (slo or {}).items() if k in STEP_SLO_KEYS}
    return picked or None


# ---- run-time snapshots (used inside the Locust step shape) -----------------------

def error_kind(error_text):
    """failure_summary's kind for one Locust error message."""
    code, _, category = _parse_error(error_text or "")
    if category:
        return {"unexpected_status": "other"}.get(category, category)
    return _meaning(code)[0]


def snapshot(num_requests, num_failures, total_response_time, errors):
    """Cumulative counters at one moment. errors: [(error text, occurrences)]."""
    kinds = {}
    for text, occurrences in errors:
        kind = error_kind(text)
        kinds[kind] = kinds.get(kind, 0) + occurrences
    return {"requests": num_requests, "failures": num_failures,
            "response_time_sum": total_response_time, "kinds": kinds}


def step_record(index, users, before, after, seconds, p95_ms):
    """What happened during one step: the difference of two snapshots."""
    requests = after["requests"] - before["requests"]
    kinds = {k: after["kinds"].get(k, 0) - before["kinds"].get(k, 0)
             for k in set(after["kinds"]) | set(before["kinds"])}
    return {
        "step": index,
        "users": users,
        "seconds": seconds,
        "requests": requests,
        "failures": after["failures"] - before["failures"],
        "avg_ms": round((after["response_time_sum"] - before["response_time_sum"]) / requests, 2)
        if requests else None,
        "p95_ms": p95_ms,
        "server_error": kinds.get("server_error", 0),
        "connection": kinds.get("connection", 0),
        "accepted_invalid_input": kinds.get("accepted_invalid_input", 0),
        "rejected_valid_input": kinds.get("rejected_valid_input", 0),
        "rate_limited": kinds.get("rate_limited", 0),
    }


def _pct(part, whole):
    return round(part / whole * 100, 2) if whole else None


def record_rates(record):
    """Failure-category rates (%) of a step record."""
    requests = record.get("requests") or 0
    return {
        "server_error_rate_pct": _pct(record.get("server_error", 0) + record.get("connection", 0), requests),
        "unexpected_outcome_rate_pct": _pct(
            record.get("accepted_invalid_input", 0) + record.get("rejected_valid_input", 0), requests),
        "rate_limited_pct": _pct(record.get("rate_limited", 0), requests),
    }


def evaluate_step(metrics, slo):
    """PASS / FAIL of one step against the per-step part of the SLO."""
    return evaluate_slo(step_slo(slo), metrics)


# ---- after the run: per-step metrics from the history CSV -------------------------

def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def history_rows(history_csv):
    """The "Aggregated" rows of a Locust stats_history CSV, oldest first."""
    rows = []
    if not history_csv:
        return rows
    for row in csv.DictReader(io.StringIO(history_csv.strip())):
        if row.get("Name") != "Aggregated":
            continue
        ts = _number(row.get("Timestamp"))
        if ts is None:
            continue
        rows.append({
            "t": ts,
            "users": _number(row.get("User Count")) or 0,
            "p95": _number(row.get("95%")),
            "total_requests": _number(row.get("Total Request Count")) or 0,
            "total_failures": _number(row.get("Total Failure Count")) or 0,
            "total_avg": _number(row.get("Total Average Response Time")) or 0,
        })
    rows.sort(key=lambda r: r["t"])
    return rows


def step_metrics(history_csv, plan, step_records=None):
    """
    One entry per step that has history rows:
        step, planned_users, users (highest observed), seconds, complete,
        requests, rps, p95_ms, avg_ms, failure_rate_pct,
        server_error_rate_pct, unexpected_outcome_rate_pct, rate_limited_pct
    The category rates are None without step records.
    """
    rows = history_rows(history_csv)
    if not rows:
        return []
    duration = plan["step_duration_seconds"]
    t0 = rows[0]["t"]
    by_step = {}
    for row in rows:
        index = int((row["t"] - t0) // duration)
        if index < len(plan["steps"]):
            by_step.setdefault(index, []).append(row)
    records = {r["step"]: r for r in step_records or []}

    result = []
    previous = {"t": t0, "total_requests": 0, "total_failures": 0, "total_avg": 0}
    for index in sorted(by_step):
        rows_in = by_step[index]
        end = rows_in[-1]
        requests = end["total_requests"] - previous["total_requests"]
        failures = end["total_failures"] - previous["total_failures"]
        span = end["t"] - previous["t"] or 1
        time_sum = end["total_avg"] * end["total_requests"] - previous["total_avg"] * previous["total_requests"]
        p95_values = [r["p95"] for r in rows_in if r["p95"] is not None]
        entry = {
            "step": index,
            "planned_users": plan["steps"][index],
            "users": int(max(r["users"] for r in rows_in)),
            "seconds": len(rows_in),
            "complete": len(rows_in) >= COMPLETE_SHARE * duration,
            "requests": int(requests),
            "rps": round(requests / span, 2),
            # Locust's p95 is over a rolling window of the last ~10 s, so the
            # value at the end of the step describes that step.
            "p95_ms": end["p95"] if end["p95"] is not None else (p95_values[-1] if p95_values else None),
            "avg_ms": round(time_sum / requests, 2) if requests else None,
            "failure_rate_pct": _pct(failures, requests),
            "server_error_rate_pct": None,
            "unexpected_outcome_rate_pct": None,
            "rate_limited_pct": None,
        }
        if index in records:
            entry.update(record_rates(records[index]))
        result.append(entry)
        previous = end
    return result


def _describe(check):
    sign = ">" if check["comparison"] == "<=" else "<"
    return f"{check['label']} {check['actual']:g} {check['unit']} {sign} {check['target']:g} {check['unit']}"


def _criteria(slo):
    words = {
        "p95_ms": lambda v: f"p95 < {v:g} ms",
        "avg_ms": lambda v: f"average < {v:g} ms",
        "max_server_error_rate_pct": lambda v: f"server errors < {v:g}%",
        "max_unexpected_outcome_rate_pct": lambda v: f"unexpected answers < {v:g}%",
    }
    return ", ".join(words[k](v) for k, v in slo.items())


def capacity_result(history_csv, plan, slo, step_records=None):
    """
    The capacity verdict:
        steps                 - step_metrics() plus each step's verdict / checks
        max_sustainable_users - highest step that passed with all lower steps passing
        breaking_point_users  - first failing step, or None
        breaking_reason       - which thresholds that step missed
        tested_up_to_users    - highest complete step
        stopped_early         - fewer steps ran than planned
        headline              - e.g. "Max sustainable: 120 users at p95 < 500 ms"
    """
    judged = step_slo(slo)
    steps = step_metrics(history_csv, plan, step_records)
    for entry in steps:
        verdict = evaluate_slo(judged, entry) if judged else None
        entry["verdict"] = verdict["verdict"] if verdict else None
        entry["failed_checks"] = [_describe(c) for c in (verdict or {}).get("checks", []) if c["passed"] is False]

    complete = [s for s in steps if s["complete"]]
    sustainable, breaking = None, None
    for entry in complete:
        if entry["verdict"] == "FAIL":
            breaking = entry
            break
        if entry["verdict"] == "PASS":
            sustainable = entry
    tested = complete[-1]["planned_users"] if complete else None
    criteria = _criteria(judged) if judged else "no SLO"

    if not judged:
        headline = "No SLO to judge the steps against"
    elif not complete:
        headline = "No complete step to judge"
    elif breaking and sustainable:
        headline = f"Max sustainable: {sustainable['planned_users']} users at {criteria}"
    elif breaking:
        headline = f"Breaks already at the first step ({breaking['planned_users']} users)"
    else:
        headline = f"No breaking point within {tested} users ({criteria} held at every step)"

    return {
        "steps": steps,
        "criteria": criteria,
        "max_sustainable_users": sustainable["planned_users"] if sustainable else None,
        "breaking_point_users": breaking["planned_users"] if breaking else None,
        "breaking_reason": "; ".join(breaking["failed_checks"]) if breaking else None,
        "tested_up_to_users": tested,
        "planned_steps": len(plan["steps"]),
        "stopped_early": len(complete) < len(plan["steps"]),
        "headline": headline,
    }
