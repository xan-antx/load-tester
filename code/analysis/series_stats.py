"""
Statistics across the repeats of a series.

One load test is a single sample: run it again and every number moves a bit.
Repeating the same configuration and looking at the spread shows whether a
difference between two results is real or just noise.
"""
import csv
import io
import statistics


def _rows(stats_csv):
    if not stats_csv:
        return []
    return list(csv.DictReader(io.StringIO(stats_csv.strip())))


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None  # Locust writes "N/A" when there is no data


def _spread(values):
    """{"mean", "std", "min", "max", "values"} of the known values. std is
    the sample standard deviation (n - 1); None with fewer than 2 values."""
    known = [v for v in values if v is not None]
    if not known:
        return {"mean": None, "std": None, "min": None, "max": None, "values": values}
    return {
        "mean": round(statistics.mean(known), 2),
        "std": round(statistics.stdev(known), 2) if len(known) >= 2 else None,
        "min": round(min(known), 2),
        "max": round(max(known), 2),
        "values": values,
    }


def summarize_series(runs):
    """
    runs: one dict per finished repeat, in order:
        {"stats_csv": Locust stats CSV, "problem_rate": percent or None}

    Returns:
        repeats - number of runs summarised
        overall - throughput (requests/s), p95 (ms) and problem_rate (%),
                  each as {"mean", "std", "min", "max", "values"}
        cases   - per case {"case", "mean_rate", "min_rate", "max_rate",
                  "runs"}: its failure rate (%) across the repeats it
                  appeared in with at least one request; highest mean first
    """
    throughput, p95, problem = [], [], []
    case_rates = {}

    for run in runs:
        rows = _rows(run.get("stats_csv"))
        total = next((r for r in rows if r.get("Name") == "Aggregated"), None)
        throughput.append(_number(total.get("Requests/s")) if total else None)
        p95.append(_number(total.get("95%")) if total else None)
        problem.append(run.get("problem_rate"))

        for r in rows:
            name = r.get("Name")
            if not name or name == "Aggregated":
                continue
            requests = _number(r.get("Request Count")) or 0
            failures = _number(r.get("Failure Count")) or 0
            if requests > 0:
                case_rates.setdefault(name, []).append(failures / requests * 100)

    cases = [
        {
            "case": name,
            "mean_rate": round(statistics.mean(rates), 1),
            "min_rate": round(min(rates), 1),
            "max_rate": round(max(rates), 1),
            "runs": len(rates),
        }
        for name, rates in case_rates.items()
    ]
    cases.sort(key=lambda c: (-c["mean_rate"], c["case"]))

    return {
        "repeats": len(runs),
        "overall": {
            "throughput": _spread(throughput),
            "p95": _spread(p95),
            "problem_rate": _spread(problem),
        },
        "cases": cases,
    }
