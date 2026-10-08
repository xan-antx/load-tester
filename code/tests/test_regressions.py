from analysis.regressions import detect_regressions

HEADER = "Type,Name,Request Count,Failure Count,95%\n"


def _stats(rows, p95):
    """rows: (name, requests, failures); adds an Aggregated row with p95."""
    lines = [f"POST,{n},{r},{f},100" for n, r, f in rows]
    lines.append(f",Aggregated,{sum(r for _, r, _ in rows)},{sum(f for _, _, f in rows)},{p95}")
    return HEADER + "\n".join(lines) + "\n"


BASELINE = _stats([("zero_x", 20, 0), ("null_p", 20, 20), ("tiny", 3, 0), ("slight", 20, 2)], 200)
CURRENT = _stats([("zero_x", 40, 12), ("null_p", 40, 40), ("tiny", 4, 4), ("slight", 40, 7)], 300)


def test_case_whose_failure_rate_rose_is_a_regression():
    result = detect_regressions(BASELINE, CURRENT)
    assert [r["case"] for r in result["regressions"]] == ["zero_x"]
    reg = result["regressions"][0]
    assert reg["baseline_rate"] == 0.0 and reg["current_rate"] == 30.0 and reg["increase"] == 30.0


def test_small_rise_below_threshold_is_not_flagged():
    # slight: 10% -> 17.5% is +7.5 points
    cases = [r["case"] for r in detect_regressions(BASELINE, CURRENT)["regressions"]]
    assert "slight" not in cases


def test_low_sample_cases_are_ignored():
    # tiny: 0% -> 100% but only 3 and 4 requests
    cases = [r["case"] for r in detect_regressions(BASELINE, CURRENT)["regressions"]]
    assert "tiny" not in cases


def test_unchanged_100_percent_case_is_not_flagged():
    cases = [r["case"] for r in detect_regressions(BASELINE, CURRENT)["regressions"]]
    assert "null_p" not in cases


def test_improvement_is_not_a_regression():
    assert detect_regressions(CURRENT, BASELINE)["regressions"] == []


def test_p95_change_in_percent():
    result = detect_regressions(BASELINE, CURRENT)
    assert result["baseline_p95"] == 200.0
    assert result["current_p95"] == 300.0
    assert result["p95_change_pct"] == 50.0


def test_first_aggregated_row_is_used_for_p95():
    doubled = BASELINE + ",Aggregated,999,999,999\n"
    assert detect_regressions(doubled, CURRENT)["baseline_p95"] == 200.0


def test_missing_data():
    result = detect_regressions(None, "")
    assert result["regressions"] == []
    assert result["p95_change_pct"] is None
