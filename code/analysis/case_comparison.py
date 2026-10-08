"""
Per-case comparison across several runs.

Aggregate totals can hide the interesting finding: if most cases fail 100% at
every load level, the overall failure rate barely moves even when a few cases
go from 0% to 30%. This lines up each edge case across runs so those cases
stand out.
"""
import csv
import io

MIN_REQUESTS = 5          # fewer requests than this = "low sample", not trusted
CHANGE_THRESHOLD = 10.0   # percentage points between runs that count as "changed"


def _per_case_counts(stats_csv):
    """{case name: (requests, failures)} from a stats CSV, ignoring the
    "Aggregated" total row(s)."""
    counts = {}
    if not stats_csv:
        return counts
    for row in csv.DictReader(io.StringIO(stats_csv.strip())):
        name = row.get("Name")
        if not name or name == "Aggregated":
            continue
        try:
            requests = int(float(row.get("Request Count") or 0))
            failures = int(float(row.get("Failure Count") or 0))
        except ValueError:
            continue
        counts[name] = (requests, failures)
    return counts


def compare_cases(stats_csv_list, min_requests=MIN_REQUESTS, threshold=CHANGE_THRESHOLD):
    """
    Lines up every edge case across the given runs (one stats CSV per run).

    Returns {"min_requests", "threshold", "rows"}. Each row is:
        case    - case name
        cells   - one entry per run, in the order given: None if the case was
                  not in that run, otherwise {requests, failures, rate,
                  low_sample}; rate is the failure % (None if 0 requests)
        spread  - biggest difference in failure rate between any two runs,
                  counting only cells with at least min_requests requests
        changed - spread >= threshold
    Changed rows come first (biggest spread first), then the rest by name.
    """
    runs = [_per_case_counts(text) for text in stats_csv_list]
    all_cases = sorted(set().union(*runs)) if runs else []

    rows = []
    for name in all_cases:
        cells = []
        trusted_rates = []
        for run in runs:
            if name not in run:
                cells.append(None)
                continue
            requests, failures = run[name]
            rate = failures / requests * 100 if requests else None
            low_sample = requests < min_requests
            if rate is not None and not low_sample:
                trusted_rates.append(rate)
            cells.append({
                "requests": requests,
                "failures": failures,
                "rate": round(rate, 1) if rate is not None else None,
                "low_sample": low_sample,
            })
        spread = max(trusted_rates) - min(trusted_rates) if len(trusted_rates) >= 2 else 0.0
        rows.append({
            "case": name,
            "cells": cells,
            "spread": round(spread, 1),
            "changed": spread >= threshold,
        })

    rows.sort(key=lambda r: (not r["changed"], -r["spread"] if r["changed"] else 0, r["case"]))
    return {"min_requests": min_requests, "threshold": threshold, "rows": rows}
