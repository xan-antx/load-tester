import os
import json
import random
from locust import HttpUser, task, between

PATHS_FILE = os.environ["LOCUST_PATHS_FILE"]

with open(PATHS_FILE) as f:
    PATHS = json.load(f)


class WebsiteUser(HttpUser):
    wait_time = between(0.5, 2)

    @task
    def visit_page(self):
        path = random.choice(PATHS)
        self.client.get(path, name=path)