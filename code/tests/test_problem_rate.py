from analysis.problem_rate import problem_rate, total_requests

STATS = (
    "Type,Name,Request Count,Failure Count\n"
    "POST,null_password,100,100\n"
    "POST,zero_x,100,30\n"
    ",Aggregated,200,130\n"
)

SUMMARY = [
    {"code": 400, "kind": "rejected", "total": 100},
    {"code": 429, "kind": "rate_limited", "total": 20},
    {"code": 500, "kind": "server_error", "total": 8},
    {"code": None, "kind": "connection", "total": 2},
]


def test_counts_only_5xx_429_and_connection_failures():
    result = problem_rate(SUMMARY, STATS)
    assert result == {"problem_count": 30, "problem_rate": 15.0}


def test_correct_4xx_rejections_are_not_problems():
    only_400s = [{"code": 400, "kind": "rejected", "total": 130}]
    assert problem_rate(only_400s, STATS) == {"problem_count": 0, "problem_rate": 0.0}


def test_other_statuses_are_not_problems():
    other = [{"code": 302, "kind": "other", "total": 5}]
    assert problem_rate(other, STATS)["problem_count"] == 0


def test_no_failures_at_all():
    assert problem_rate([], STATS) == {"problem_count": 0, "problem_rate": 0.0}
    assert problem_rate(None, STATS) == {"problem_count": 0, "problem_rate": 0.0}


def test_unknown_or_zero_total_gives_no_rate():
    assert problem_rate(SUMMARY, None)["problem_rate"] is None
    zero = "Type,Name,Request Count,Failure Count\n,Aggregated,0,0\n"
    assert problem_rate(SUMMARY, zero)["problem_rate"] is None


def test_total_uses_first_aggregated_row():
    doubled = STATS + ",Aggregated,400,260\n"
    assert total_requests(doubled) == 200


def test_rounds_to_one_decimal():
    stats = "Type,Name,Request Count,Failure Count\n,Aggregated,3,1\n"
    summary = [{"kind": "server_error", "total": 1}]
    assert problem_rate(summary, stats)["problem_rate"] == 33.3
