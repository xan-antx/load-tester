# Having a conftest.py here makes pytest put this directory (code/) on
# sys.path, so tests in code/tests/ can import app, analysis, stats_aggregator
# etc. even under plain `pytest` (which, unlike `python -m pytest`, does not add
# the current directory). GitLab CI runs plain `pytest` with code/ as the root.
import os

# Set before any test imports app.py:
# - importing app must not mark a developer's real runs (in load_tests.db) as
#   "interrupted" — that startup sweep is tested separately;
# - many tests start several runs without finishing them; the "at most N
#   active runs" limit has its own tests, which set MAX_ACTIVE_RUNS themselves.
os.environ.setdefault("RECOVER_STALE_RUNS", "false")
os.environ.setdefault("MAX_ACTIVE_RUNS", "1000")
