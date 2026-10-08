# Having a conftest.py here makes pytest put this directory (code/) on
# sys.path, so tests in code/tests/ can import app, analysis, stats_aggregator
# etc. even under plain `pytest` (which, unlike `python -m pytest`, does not add
# the current directory). GitLab CI runs plain `pytest` with code/ as the root.
