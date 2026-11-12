import os
import sys
import json
import random
from locust import HttpUser, task, between

# expectations.py sits next to this file; make it importable however Locust
# was started.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from expectations import classify_outcome, failure_message  # noqa: E402

CASES_FILE = os.environ["LOCUST_CASES_FILE"]
TARGET_PATH = os.environ.get("LOCUST_TARGET_PATH", "/")
# Optional request headers (e.g. Authorization), passed only via the
# environment so their values are never written to disk.
HEADERS = json.loads(os.environ.get("LOCUST_HEADERS") or "{}")

with open(CASES_FILE) as f:
    CASES = json.load(f)


class ApiEdgeCaseUser(HttpUser):
    wait_time = between(0.5, 2)

    @task
    def send_edge_case(self):
        case = random.choice(CASES)
        expect = case.get("expect")
        if expect not in ("accept", "reject"):
            # Cases from older clients carry no expectation: keep Locust's
            # default rule (any 4xx or 5xx is a failure).
            self.client.post(TARGET_PATH, json=case["payload"], name=case["label"], headers=HEADERS)
            return

        # A request succeeds when the answer matches what a correct API
        # should say: 2xx for valid input, 4xx (not 429) for invalid input.
        with self.client.post(TARGET_PATH, json=case["payload"], name=case["label"], headers=HEADERS,
                              catch_response=True) as resp:
            matched, category = classify_outcome(resp.status_code, expect)
            if matched:
                resp.success()
            else:
                resp.failure(failure_message(category, resp.status_code, expect, resp.error))
