"""
Step load for capacity runs ("Find capacity").

Combined with a user locustfile on the command line, so normal runs never
load it:
    locust -f dynamic_locustfile.py,step_shape.py ...

Configured through LOCUST_STEP_PLAN (JSON):
    steps                 - users per step, e.g. [20, 40, 60]
    step_duration_seconds - how long each step lasts
    spawn_rate            - users started per second when stepping up
    slo                   - thresholds judged per step (may be empty)
    early_stop            - stop after the first step that misses the SLO
    steps_file            - where to write one record per finished step

At the end of every step the shape records what happened in that step
(requests, average, p95, failures by category) and, with early_stop, ends the
test if the step missed its SLO. The pure logic lives in analysis/capacity.py.
"""
import json
import os
import sys

from locust import LoadTestShape

# code/ on the path, for analysis.capacity.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from analysis.capacity import evaluate_step, record_rates, snapshot, step_record  # noqa: E402

PLAN = json.loads(os.environ.get("LOCUST_STEP_PLAN") or "{}")
STEPS = PLAN.get("steps") or [1]
STEP_SECONDS = PLAN.get("step_duration_seconds") or 10
SPAWN_RATE = PLAN.get("spawn_rate") or 1
SLO = PLAN.get("slo") or {}
EARLY_STOP = bool(PLAN.get("early_stop"))
STEPS_FILE = PLAN.get("steps_file")


class StepLoadShape(LoadTestShape):
    """Holds STEPS[i] users during step i, then stops."""

    def __init__(self):
        super().__init__()
        self._closed = -1          # index of the last recorded step
        self._before = None        # counters at the start of the open step
        self._records = []

    def _now(self):
        stats = self.runner.stats
        total = stats.total
        errors = [(repr(e.error) if not isinstance(e.error, str) else e.error, e.occurrences)
                  for e in stats.errors.values()]
        return snapshot(total.num_requests, total.num_failures, total.total_response_time, errors)

    def _close_step(self, index):
        """Records step `index`; returns True when it missed the SLO."""
        after = self._now()
        before = self._before or snapshot(0, 0, 0, [])
        p95 = self.runner.stats.total.get_current_response_time_percentile(0.95)
        record = step_record(index, STEPS[index], before, after, STEP_SECONDS, p95)
        metrics = {"p95_ms": record["p95_ms"], "avg_ms": record["avg_ms"], **record_rates(record)}
        verdict = evaluate_step(metrics, SLO)
        record["verdict"] = verdict["verdict"] if verdict else None
        self._records.append(record)
        self._before = after
        self._closed = index
        if STEPS_FILE:
            with open(STEPS_FILE, "w") as f:
                json.dump(self._records, f)
        return record["verdict"] == "FAIL"

    def tick(self):
        index = int(self.get_run_time() // STEP_SECONDS)
        if self._before is None:
            self._before = self._now()
        # Crossed one or more step boundaries since the last tick.
        while self._closed < min(index, len(STEPS)) - 1:
            failed = self._close_step(self._closed + 1)
            if failed and EARLY_STOP:
                return None
        if index >= len(STEPS):
            return None
        return STEPS[index], SPAWN_RATE
