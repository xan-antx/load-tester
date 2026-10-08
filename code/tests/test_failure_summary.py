from analysis.failure_summary import summarize_failures

HEADER = "Method,Name,Error,Occurrences,First Seen,Last Seen\n"


def _csv(*rows):
    lines = [f'POST,{name},"{error}",{n},t1,t2' for name, error, n in rows]
    return HEADER + "\n".join(lines) + "\n"


def _by_code(summary):
    return {g["code"]: g for g in summary}


def test_real_locust_errors_group_by_status_code():
    text = _csv(
        ("null_password", "HTTPError('400 Client Error: BAD REQUEST for url: null_password')", 15),
        ("missing_username", "HTTPError('400 Client Error: BAD REQUEST for url: missing_username')", 9),
        ("zero_x", "HTTPError('429 Client Error: TOO MANY REQUESTS for url: zero_x')", 10),
        ("null_password", "HTTPError('429 Client Error: TOO MANY REQUESTS for url: null_password')", 2),
        ("very_large_x", "HTTPError('500 Server Error: INTERNAL SERVER ERROR for url: very_large_x')", 12),
    )
    groups = _by_code(summarize_failures(text))
    assert set(groups) == {400, 429, 500}

    assert groups[400]["total"] == 24
    assert groups[400]["meaning"] == "Rejected — invalid input"
    assert groups[400]["reason"] == "BAD REQUEST"
    assert groups[400]["cases"] == [
        {"case": "null_password", "occurrences": 15},
        {"case": "missing_username", "occurrences": 9},
    ]
    assert groups[429]["meaning"] == "Rate limited — too many requests"
    assert groups[429]["kind"] == "rate_limited"
    assert groups[500]["meaning"] == "Server error — the server failed"


def test_groups_are_sorted_by_total_descending():
    text = _csv(
        ("a", "HTTPError('500 Server Error: INTERNAL SERVER ERROR for url: a')", 1),
        ("b", "HTTPError('400 Client Error: BAD REQUEST for url: b')", 50),
    )
    assert [g["code"] for g in summarize_failures(text)] == [400, 500]


def test_same_case_with_two_errors_of_same_code_is_summed():
    text = _csv(
        ("x", "HTTPError('404 Client Error: NOT FOUND for url: /x')", 3),
        ("x", "HTTPError('404 Client Error: Not Found for url: /x?y')", 4),
    )
    (group,) = summarize_failures(text)
    assert group["cases"] == [{"case": "x", "occurrences": 7}]
    assert group["kind"] == "rejected"


def test_quoted_commas_in_error_text_are_parsed():
    text = _csv(
        ("q", "HTTPError('400 Client Error: Bad Request, missing field for url: q')", 2),
    )
    (group,) = summarize_failures(text)
    assert group["code"] == 400
    assert group["reason"] == "Bad Request, missing field"
    assert group["total"] == 2


def test_non_http_errors_become_connection_failures():
    text = _csv(
        ("a", "ConnectionRefusedError(10061, '[WinError 10061] No connection could be made')", 5),
        ("b", "RemoteDisconnected('Remote end closed connection without response')", 1),
    )
    (group,) = summarize_failures(text)
    assert group["code"] is None
    assert group["kind"] == "connection"
    assert group["meaning"] == "Connection failure"
    assert group["total"] == 6


def test_empty_or_missing_input():
    assert summarize_failures(None) == []
    assert summarize_failures("") == []
    assert summarize_failures(HEADER) == []
