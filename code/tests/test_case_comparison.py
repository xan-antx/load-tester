from analysis.case_comparison import compare_cases

HEADER = "Type,Name,Request Count,Failure Count\n"


def _stats(*rows):
    """rows: (name, requests, failures). Adds an Aggregated row like Locust."""
    lines = [f"POST,{n},{r},{f}" for n, r, f in rows]
    lines.append(f",Aggregated,{sum(r for _, r, _ in rows)},{sum(f for _, _, f in rows)}")
    return HEADER + "\n".join(lines) + "\n"


def _row(result, case):
    return next(r for r in result["rows"] if r["case"] == case)


LOW = _stats(("null_password", 20, 20), ("zero_expires", 20, 0), ("tiny", 2, 0))
HIGH = _stats(("null_password", 40, 40), ("zero_expires", 40, 12), ("tiny", 3, 3))


def test_case_that_starts_failing_under_load_is_changed():
    result = compare_cases([LOW, HIGH])
    row = _row(result, "zero_expires")
    assert row["changed"] is True
    assert row["spread"] == 30.0
    assert [c["rate"] for c in row["cells"]] == [0.0, 30.0]


def test_case_failing_100_percent_everywhere_is_not_changed():
    row = _row(compare_cases([LOW, HIGH]), "null_password")
    assert row["changed"] is False
    assert row["spread"] == 0.0


def test_low_sample_cells_are_flagged_and_ignored_for_change():
    row = _row(compare_cases([LOW, HIGH]), "tiny")
    assert [c["low_sample"] for c in row["cells"]] == [True, True]
    # 0% -> 100% but both cells have fewer than 5 requests
    assert row["changed"] is False


def test_changed_rows_are_sorted_first():
    result = compare_cases([LOW, HIGH])
    assert result["rows"][0]["case"] == "zero_expires"
    assert all(not r["changed"] for r in result["rows"][1:])


def test_aggregated_row_is_not_a_case():
    result = compare_cases([LOW, HIGH])
    assert "Aggregated" not in [r["case"] for r in result["rows"]]


def test_case_missing_from_a_run_has_none_cell():
    other = _stats(("only_here", 10, 5))
    row = _row(compare_cases([LOW, other]), "only_here")
    assert row["cells"][0] is None
    assert row["cells"][1]["rate"] == 50.0
    assert row["changed"] is False  # only one trusted cell


def test_threshold_is_inclusive_and_uses_any_two_runs():
    a = _stats(("x", 10, 0))
    b = _stats(("x", 10, 0))
    c = _stats(("x", 10, 1))  # exactly 10 points above a
    row = _row(compare_cases([a, b, c]), "x")
    assert row["spread"] == 10.0
    assert row["changed"] is True


def test_empty_and_missing_inputs():
    assert compare_cases([])["rows"] == []
    assert compare_cases([None, ""])["rows"] == []
