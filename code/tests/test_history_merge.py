import csv
import io

from stats_aggregator import merge_history_csvs

# Locust's real history header (only "Aggregated" rows are written by default).
HEADER = ("Timestamp,User Count,Type,Name,Requests/s,Failures/s,50%,66%,75%,80%,90%,95%,98%,99%,"
          "99.9%,99.99%,100%,Total Request Count,Total Failure Count,Total Median Response Time,"
          "Total Average Response Time,Total Min Response Time,Total Max Response Time,"
          "Total Average Content Size\n")


def _history(*rows):
    """rows: (timestamp, users, rps, fps, p95, avg). p95 may be "N/A"."""
    lines = [
        f"{t},{u},,Aggregated,{rps},{fps},1,1,1,1,1,{p95},1,1,1,1,1,0,0,0,{avg},0,0,0"
        for t, u, rps, fps, p95, avg in rows
    ]
    return HEADER + "\n".join(lines) + "\n"


def _rows(text):
    return list(csv.DictReader(io.StringIO(text)))


CHILD_1 = _history((100, 0, 0, 0, "N/A", 0.0), (101, 40, 10, 2, 200, 100.0), (102, 50, 20, 4, 300, 120.0))
CHILD_2 = _history((101, 40, 30, 6, 400, 200.0), (102, 50, 20, 4, 500, 180.0), (103, 50, 25, 5, 600, 190.0))


def test_merges_rows_with_the_same_second():
    merged = _rows(merge_history_csvs([CHILD_1, CHILD_2]))
    assert [int(r["Timestamp"]) for r in merged] == [100, 101, 102, 103]
    second_101 = merged[1]
    assert int(second_101["User Count"]) == 80
    assert float(second_101["Requests/s"]) == 40.0
    assert float(second_101["Failures/s"]) == 8.0


def test_response_times_are_weighted_by_requests_per_second():
    second_101 = _rows(merge_history_csvs([CHILD_1, CHILD_2]))[1]
    # (100*10 + 200*30) / 40 = 175 ; p95 (200*10 + 400*30) / 40 = 350
    assert float(second_101["Total Average Response Time"]) == 175.0
    assert float(second_101["95%"]) == 350.0


def test_second_present_in_only_one_child_keeps_its_values():
    last = _rows(merge_history_csvs([CHILD_1, CHILD_2]))[-1]
    assert int(last["User Count"]) == 50
    assert float(last["Total Average Response Time"]) == 190.0


def test_na_values_and_zero_throughput_are_handled():
    first = _rows(merge_history_csvs([CHILD_1, CHILD_2]))[0]
    assert first["95%"] == "N/A"
    assert float(first["Total Average Response Time"]) == 0.0


def test_non_aggregated_rows_are_ignored():
    extra = HEADER + "101,40,POST,some_case,99,99,1,1,1,1,1,999,1,1,1,1,1,0,0,0,999,0,0,0\n"
    merged = _rows(merge_history_csvs([CHILD_1, extra]))
    assert float(merged[1]["Requests/s"]) == 10.0


def test_output_has_locust_column_names():
    merged = _rows(merge_history_csvs([CHILD_1]))
    assert merged[0]["Name"] == "Aggregated"
    assert {"Timestamp", "User Count", "Requests/s", "95%", "Total Average Response Time"} <= set(merged[0])


def test_empty_input_returns_none():
    assert merge_history_csvs([]) is None
    assert merge_history_csvs([None, HEADER]) is None
