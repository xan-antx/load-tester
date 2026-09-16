import time
from sqs_client import receive_job_messages, delete_job_message
from load_test_runner import _run_api_job, _run_website_job
from job_store import init_db

init_db()

print("Worker started. Polling SQS for jobs...")

while True:
    messages = receive_job_messages(max_messages=1, wait_time_seconds=10)
    if not messages:
        continue

    for receipt_handle, payload in messages:
        job_type = payload.get("job_type")
        job_id = payload.get("job_id")
        print(f"Picked up job {job_id} (type: {job_type})")

        try:
            if job_type == "api":
                _run_api_job(
                    job_id,
                    payload["target_url"],
                    payload["target_path"],
                    payload["cases"],
                    payload["users"],
                    payload["spawn_rate"],
                    payload["duration_seconds"],
                )
            elif job_type == "website":
                _run_website_job(
                    job_id,
                    payload["target_url"],
                    payload["paths"],
                    payload["users"],
                    payload["spawn_rate"],
                    payload["duration_seconds"],
                )
            else:
                print(f"Unknown job_type: {job_type}, skipping")
        except Exception as e:
            print(f"Error processing job {job_id}: {e}")
        finally:
            delete_job_message(receipt_handle)
            print(f"Job {job_id} processed and removed from queue")