import os
import json
import random
from locust import HttpUser, task, between

CASES_FILE = os.environ["LOCUST_CASES_FILE"]
TARGET_PATH = os.environ.get("LOCUST_TARGET_PATH", "/")

with open(CASES_FILE) as f:
    CASES = json.load(f)


class ApiEdgeCaseUser(HttpUser):
    wait_time = between(0.5, 2)

    @task
    def send_edge_case(self):
        case = random.choice(CASES)
        self.client.post(TARGET_PATH, json=case["payload"], name=case["label"])