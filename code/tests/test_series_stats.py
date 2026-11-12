from analysis.series_stats import summarize_series

HEADER = "Type,Name,Request Count,Failure Count,Requests/s,95%\n"


def _stats(cases, rps, p95):
    lines = [f"POST,{name},{req},{fail},1,100" for name, req, fail in cases]
    total_req = sum(c[1] for c in cases)
    total_fail = sum(c[2] for c in cases)
    lines.append(f",Aggregated,{total_req},{total_fail},{rps},{p95}")
    return HEADER + "\n".join(lines) + "\n"


RUNS = [
    {"stats_csv": _stats([("zero_x", 10, 0), ("null_p", 10, 10)], 10.0, 150), "problem_rate": 5.0},
    {"stats_csv": _stats([("zero_x", 10, 2), ("null_p", 10, 10)], 12.0, 170), "problem_rate": 7.0},
    {"stats_csv": _stats([("zero_x", 10, 4), ("null_p", 10, 10)], 14.0, 190), "problem_rate": 9.0},
]


def test_overall_mean_and_sample_standard_deviation():
    overall = summarize_series(RUNS)["overall"]
    assert overall["throughput"]["mean"] == 12.0
    assert overall["throughput"]["std"] == 2.0          # stdev of 10, 12, 14
    assert overall["p95"]["mean"] == 170.0 and overall["p95"]["std"] == 20.0
    assert overall["problem_rate"] == {"mean": 7.0, "std": 2.0, "min": 5.0, "max": 9.0,
                                       "values": [5.0, 7.0, 9.0]}


def test_per_case_mean_and_range_highest_first():
    summary = summarize_series(RUNS)
    assert summary["repeats"] == 3
    assert summary["cases"] == [
        {"case": "null_p", "mean_rate": 100.0, "min_rate": 100.0, "max_rate": 100.0, "runs": 3},
        {"case": "zero_x", "mean_rate": 20.0, "min_rate": 0.0, "max_rate": 40.0, "runs": 3},
    ]


def test_single_repeat_has_no_standard_deviation():
    overall = summarize_series(RUNS[:1])["overall"]
    assert overall["throughput"]["mean"] == 10.0
    assert overall["throughput"]["std"] is None


def test_missing_values_are_skipped():
    runs = [
        {"stats_csv": None, "problem_rate": None},
        {"stats_csv": _stats([("a", 4, 1)], 8.0, "N/A"), "problem_rate": 2.5},
    ]
    summary = summarize_series(runs)
    assert summary["overall"]["throughput"]["mean"] == 8.0
    assert summary["overall"]["throughput"]["values"] == [None, 8.0]
    assert summary["overall"]["p95"]["mean"] is None
    assert summary["cases"] == [{"case": "a", "mean_rate": 25.0, "min_rate": 25.0, "max_rate": 25.0, "runs": 1}]


def test_case_missing_from_a_repeat_counts_only_where_present():
    runs = RUNS[:2] + [{"stats_csv": _stats([("null_p", 10, 5)], 9.0, 160), "problem_rate": 1.0}]
    zero_x = next(c for c in summarize_series(runs)["cases"] if c["case"] == "zero_x")
    assert zero_x["runs"] == 2 and zero_x["mean_rate"] == 10.0


def test_no_runs():
    summary = summarize_series([])
    assert summary["repeats"] == 0 and summary["cases"] == []
    assert summary["overall"]["p95"]["mean"] is None
