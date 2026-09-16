import os
import json
import boto3

SQS_QUEUE_URL = os.environ.get("SQS_QUEUE_URL")
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "eu-north-1")

_sqs = None


def get_sqs_client():
    global _sqs
    if _sqs is None:
        _sqs = boto3.client("sqs", region_name=AWS_REGION)
    return _sqs


def send_job_message(job_payload: dict):
    """Pushes a job onto the SQS queue instead of running it locally."""
    sqs = get_sqs_client()
    sqs.send_message(
        QueueUrl=SQS_QUEUE_URL,
        MessageBody=json.dumps(job_payload),
    )


def receive_job_messages(max_messages=1, wait_time_seconds=10):
    """Long-polls the queue for job messages. Returns a list of (receipt_handle, payload) tuples."""
    sqs = get_sqs_client()
    resp = sqs.receive_message(
        QueueUrl=SQS_QUEUE_URL,
        MaxNumberOfMessages=max_messages,
        WaitTimeSeconds=wait_time_seconds,
    )
    messages = resp.get("Messages", [])
    results = []
    for msg in messages:
        try:
            payload = json.loads(msg["Body"])
            results.append((msg["ReceiptHandle"], payload))
        except json.JSONDecodeError:
            continue
    return results


def delete_job_message(receipt_handle: str):
    """Removes a message from the queue once it's been successfully processed."""
    sqs = get_sqs_client()
    sqs.delete_message(QueueUrl=SQS_QUEUE_URL, ReceiptHandle=receipt_handle)