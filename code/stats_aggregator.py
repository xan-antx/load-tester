import csv
import io

CSV_HEADER = [
    "Type", "Name", "Request Count", "Failure Count", "Median Response Time",
    "Average Response Time", "Min Response Time", "Max Response Time",
    "Average Content Size", "Requests/s", "Failures/s",
    "50%", "66%", "75%", "80%", "90%", "95%", "98%", "99%", "99.9%", "99.99%", "100%",
]

NUMERIC_FIELDS = CSV_HEADER[2:]

FAILURES_CSV_HEADER = ["Method", "Name", "Error", "Occurrences"]


def _parse_csv(csv_text):
    if not csv_text:
        return []
    reader = csv.DictReader(io.StringIO(csv_text.strip()))
    rows = []
    for row in reader:
        if not row.get("Name"):
            continue
        rows.append(row)
    return rows


def merge_failures_csvs(csv_list):
    """
    Merges multiple Locust --csv failures outputs (one per child job) into a
    single combined report by summing Occurrences grouped on (Name, Error).
    Returns None when the merged result contains no failure rows.
    """
    grouped = {}
    for csv_text in csv_list:
        if not csv_text:
            continue
        reader = csv.DictReader(io.StringIO(csv_text.strip()))
        for row in reader:
            if not row.get("Name"):
                continue
            key = (row["Name"], row.get("Error") or "")
            if key not in grouped:
                grouped[key] = {"Method": row.get("Method") or "", "Occurrences": 0}
            try:
                occurrences = int(float(row.get("Occurrences") or 0))
            except ValueError:
                occurrences = 0
            grouped[key]["Occurrences"] += occurrences

    if not grouped:
        return None

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FAILURES_CSV_HEADER)
    writer.writeheader()
    for (name, error), g in grouped.items():
        writer.writerow({
            "Method": g["Method"],
            "Name": name,
            "Error": error,
            "Occurrences": g["Occurrences"],
        })
    return buf.getvalue()


HISTORY_CSV_HEADER = [
    "Timestamp", "User Count", "Type", "Name", "Requests/s", "Failures/s",
    "95%", "Total Average Response Time",
]


def _to_float(value):
    """Locust writes "N/A" when a value has no data yet."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _weighted(values_and_weights):
    """Average of values weighted by their weights; plain average if every
    weight is 0; None if there are no values."""
    pairs = [(v, w) for v, w in values_and_weights if v is not None]
    if not pairs:
        return None
    total_weight = sum(w for _, w in pairs)
    if total_weight > 0:
        return sum(v * w for v, w in pairs) / total_weight
    return sum(v for v, _ in pairs) / len(pairs)


def merge_history_csvs(csv_list):
    """
    Merges Locust's per-second history files (one per child job) into one
    timeline. Only the "Aggregated" rows are used. Rows from different
    children with the same Timestamp (a whole second) are combined:
    User Count, Requests/s and Failures/s are summed; the average response
    time and p95 are averaged, weighted by each child's Requests/s.
    The output keeps Locust's column names, so it reads like a single run's
    history file. Returns None if there is nothing to merge.
    """
    seconds = {}
    for csv_text in csv_list:
        if not csv_text:
            continue
        for row in csv.DictReader(io.StringIO(csv_text.strip())):
            if row.get("Name") != "Aggregated":
                continue
            timestamp = _to_float(row.get("Timestamp"))
            if timestamp is None:
                continue
            bucket = seconds.setdefault(int(timestamp), {
                "users": 0.0, "rps": 0.0, "fps": 0.0, "avg": [], "p95": [],
            })
            rps = _to_float(row.get("Requests/s")) or 0.0
            bucket["users"] += _to_float(row.get("User Count")) or 0.0
            bucket["rps"] += rps
            bucket["fps"] += _to_float(row.get("Failures/s")) or 0.0
            bucket["avg"].append((_to_float(row.get("Total Average Response Time")), rps))
            bucket["p95"].append((_to_float(row.get("95%")), rps))

    if not seconds:
        return None

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=HISTORY_CSV_HEADER)
    writer.writeheader()
    for timestamp in sorted(seconds):
        b = seconds[timestamp]
        avg = _weighted(b["avg"])
        p95 = _weighted(b["p95"])
        writer.writerow({
            "Timestamp": timestamp,
            "User Count": int(b["users"]),
            "Type": "",
            "Name": "Aggregated",
            "Requests/s": round(b["rps"], 4),
            "Failures/s": round(b["fps"], 4),
            "95%": round(p95, 2) if p95 is not None else "N/A",
            "Total Average Response Time": round(avg, 2) if avg is not None else "N/A",
        })
    return buf.getvalue()


def merge_stats_csvs(csv_list):
    """
    Merges multiple Locust --csv stats outputs (one per child job) into a
    single combined report, keyed by row Name (edge case label or page path).

    Request/failure counts and requests-per-second are summed exactly.
    Response time averages are combined as a weighted average by request
    count. Min/Max take the extreme across all children. Percentile columns
    are approximated as a weighted average of each child's percentile value
    — this is not a statistically exact recombination of percentiles, but
    gives a reasonable indicative figure across the merged run.
    """
    grouped = {}
    row_type = "GET"

    for csv_text in csv_list:
        for row in _parse_csv(csv_text):
            name = row["Name"]
            # Each child's own "Aggregated" total is skipped: the merged total
            # is rebuilt from the per-case rows below. Merging it like a normal
            # row would emit a second, double-counted "Aggregated" row.
            if name == "Aggregated":
                continue
            row_type = row.get("Type", row_type)
            count = float(row.get("Request Count") or 0)
            if name not in grouped:
                grouped[name] = {
                    "request_count": 0.0,
                    "failure_count": 0.0,
                    "min": None,
                    "max": None,
                    "weighted_fields": {f: 0.0 for f in NUMERIC_FIELDS if f not in (
                        "Request Count", "Failure Count", "Min Response Time", "Max Response Time"
                    )},
                }
            g = grouped[name]
            g["request_count"] += count
            g["failure_count"] += float(row.get("Failure Count") or 0)

            row_min = float(row.get("Min Response Time") or 0)
            row_max = float(row.get("Max Response Time") or 0)
            g["min"] = row_min if g["min"] is None else min(g["min"], row_min)
            g["max"] = row_max if g["max"] is None else max(g["max"], row_max)

            for field in g["weighted_fields"]:
                try:
                    value = float(row.get(field) or 0)
                except ValueError:
                    value = 0.0
                if field in ("Requests/s", "Failures/s"):
                    g["weighted_fields"][field] += value  # throughput sums directly
                else:
                    g["weighted_fields"][field] += value * count  # weighted by request count

    output_rows = []
    total_requests = 0.0
    total_failures = 0.0
    aggregate_weighted = {f: 0.0 for f in NUMERIC_FIELDS if f not in (
        "Request Count", "Failure Count", "Min Response Time", "Max Response Time", "Requests/s", "Failures/s"
    )}
    aggregate_throughput = {"Requests/s": 0.0, "Failures/s": 0.0}
    overall_min, overall_max = None, None

    for name, g in grouped.items():
        count = g["request_count"] or 1  # avoid divide-by-zero
        row = {
            "Type": row_type,
            "Name": name,
            "Request Count": int(g["request_count"]),
            "Failure Count": int(g["failure_count"]),
            "Min Response Time": g["min"] or 0,
            "Max Response Time": g["max"] or 0,
        }
        for field, weighted_sum in g["weighted_fields"].items():
            if field in ("Requests/s", "Failures/s"):
                row[field] = round(weighted_sum, 4)
            else:
                row[field] = round(weighted_sum / count, 2)
        output_rows.append(row)

        total_requests += g["request_count"]
        total_failures += g["failure_count"]
        overall_min = g["min"] if overall_min is None else min(overall_min, g["min"])
        overall_max = g["max"] if overall_max is None else max(overall_max, g["max"])
        for field in aggregate_weighted:
            aggregate_weighted[field] += g["weighted_fields"][field]
        for field in aggregate_throughput:
            aggregate_throughput[field] += g["weighted_fields"][field]

    agg_count = total_requests or 1
    aggregated_row = {
        "Type": "",
        "Name": "Aggregated",
        "Request Count": int(total_requests),
        "Failure Count": int(total_failures),
        "Min Response Time": overall_min or 0,
        "Max Response Time": overall_max or 0,
    }
    for field, weighted_sum in aggregate_weighted.items():
        aggregated_row[field] = round(weighted_sum / agg_count, 2)
    for field, total in aggregate_throughput.items():
        aggregated_row[field] = round(total, 4)

    output_rows.append(aggregated_row)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_HEADER)
    writer.writeheader()
    for row in output_rows:
        writer.writerow(row)
    return buf.getvalue()