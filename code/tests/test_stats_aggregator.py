import csv
import io

from stats_aggregator import CSV_HEADER, merge_failures_csvs, merge_stats_csvs


def _stats_csv(rows):
    """Builds a Locust-style stats CSV. rows: list of (name, requests, failures,
    avg_ms, p95_ms, rps). Adds the child's own "Aggregated" row like Locust does."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_HEADER)
    writer.writeheader()
    total_req = sum(r[1] for r in rows)
    total_fail = sum(r[2] for r in rows)
    for name, req, fail, avg, p95, rps in rows + [("Aggregated", total_req, total_fail, 100, 200, 9.9)]:
        row = {h: 0 for h in CSV_HEADER}
        row.update({
            "Type": "" if name == "Aggregated" else "POST", "Name": name,
            "Request Count": req, "Failure Count": fail,
            "Average Response Time": avg, "Min Response Time": 10, "Max Response Time": 900,
            "95%": p95, "Requests/s": rps,
        })
        writer.writerow(row)
    return buf.getvalue()


def _rows(csv_text):
    return list(csv.DictReader(io.StringIO(csv_text)))


CHILD_A = _stats_csv([("missing_password", 10, 10, 100, 150, 1.0), ("zero_x", 20, 2, 200, 300, 2.0)])
CHILD_B = _stats_csv([("missing_password", 5, 5, 300, 350, 0.5), ("zero_x", 10, 4, 100, 200, 1.0)])
CHILD_C = _stats_csv([("missing_password", 5, 5, 100, 150, 0.5), ("only_in_c", 4, 0, 50, 60, 0.4)])


def test_three_child_merge_has_exactly_one_aggregated_row():
    merged = _rows(merge_stats_csvs([CHILD_A, CHILD_B, CHILD_C]))
    assert [r["Name"] for r in merged].count("Aggregated") == 1
    assert merged[-1]["Name"] == "Aggregated"


def test_three_child_merge_totals_are_not_double_counted():
    merged = _rows(merge_stats_csvs([CHILD_A, CHILD_B, CHILD_C]))
    agg = next(r for r in merged if r["Name"] == "Aggregated")
    # 10+20 + 5+10 + 5+4 requests, 10+2 + 5+4 + 5+0 failures
    assert int(agg["Request Count"]) == 54
    assert int(agg["Failure Count"]) == 26
    cases = [r for r in merged if r["Name"] != "Aggregated"]
    assert sum(int(r["Request Count"]) for r in cases) == int(agg["Request Count"])


def test_merge_sums_per_case_counts_and_weights_averages():
    merged = {r["Name"]: r for r in _rows(merge_stats_csvs([CHILD_A, CHILD_B, CHILD_C]))}
    mp = merged["missing_password"]
    assert int(mp["Request Count"]) == 20
    assert int(mp["Failure Count"]) == 20
    # weighted by request count: (10*100 + 5*300 + 5*100) / 20
    assert float(mp["Average Response Time"]) == 150.0
    assert float(mp["Requests/s"]) == 2.0  # throughput sums
    assert "only_in_c" in merged


def test_merge_of_single_child_matches_its_cases():
    merged = _rows(merge_stats_csvs([CHILD_A]))
    assert [r["Name"] for r in merged].count("Aggregated") == 1
    agg = merged[-1]
    assert int(agg["Request Count"]) == 30


FAILURES_HEADER = "Method,Name,Error,Occurrences,First Seen,Last Seen\n"


def test_merge_failures_sums_by_case_and_error():
    a = FAILURES_HEADER + "POST,null_password,\"HTTPError('400 Client Error: BAD REQUEST for url: null_password')\",3,t1,t2\n"
    b = FAILURES_HEADER + "POST,null_password,\"HTTPError('400 Client Error: BAD REQUEST for url: null_password')\",4,t1,t2\n"
    merged = _rows(merge_failures_csvs([a, b]))
    assert len(merged) == 1
    assert merged[0]["Occurrences"] == "7"


def test_merge_failures_empty_input_returns_none():
    assert merge_failures_csvs([]) is None
    assert merge_failures_csvs([FAILURES_HEADER]) is None
