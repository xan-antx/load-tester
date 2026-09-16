import csv
import io

CSV_HEADER = [
    "Type", "Name", "Request Count", "Failure Count", "Median Response Time",
    "Average Response Time", "Min Response Time", "Max Response Time",
    "Average Content Size", "Requests/s", "Failures/s",
    "50%", "66%", "75%", "80%", "90%", "95%", "98%", "99%", "99.9%", "99.99%", "100%",
]

NUMERIC_FIELDS = CSV_HEADER[2:]


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