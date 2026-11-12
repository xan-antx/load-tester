FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as an unprivileged user. /app holds load_test_results/ (Locust CSVs);
# /data is where the Kubernetes volume and docker compose keep the SQLite DB.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data /app/load_test_results \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 5000

# gunicorn instead of Flask's development server. Exactly ONE worker process
# with several threads ("gthread"):
#  - load tests run in background threads of the process that started them,
#    and the process keeps the running Locust processes, stop requests and
#    repeat-series threads in memory, so every request must reach that same
#    process (several workers would each see only their own runs);
#  - SQLite is single-writer, so one process avoids lock contention;
#  - threads let health checks and status polls be answered while other
#    requests (an analyze probe can take ~15 s) are in progress.
# Background threads are unaffected by gunicorn's worker timeout: with gthread
# the heartbeat comes from the worker's main loop, not from request threads.
CMD ["gunicorn", "--worker-class", "gthread", "--workers", "1", "--threads", "8", \
     "--timeout", "120", "--bind", "0.0.0.0:5000", "--access-logfile", "-", "app:app"]
