import sqlite3
import json
import os
import threading
from contextlib import contextmanager

DB_PATH = os.environ.get("DB_PATH", "load_tests.db")
_lock = threading.Lock()

# JSON-text columns describing how a run was configured (on jobs and groups):
#   case_expectations - {case label: "accept" | "reject"} (expected outcomes)
#   slo               - SLO thresholds, e.g. {"p95_ms": 500} (analysis/slo.py)
#   mode              - "fixed" (default) or "capacity"
#   capacity_plan     - the step plan of a capacity run (analysis/capacity.py)
#   capacity_steps    - per-step records written during a capacity run
RUN_META_COLUMNS = ("case_expectations", "slo", "mode", "capacity_plan", "capacity_steps")

# Statuses that end a run (completed_at is set when one is reached).
FINISHED = ("completed", "failed", "timeout", "cancelled", "interrupted")
# Statuses of a run that is still in progress.
IN_PROGRESS = ("queued", "running")


@contextmanager
def _get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                target_url TEXT,
                users INTEGER,
                spawn_rate INTEGER,
                duration_seconds INTEGER,
                status TEXT,
                stats_csv TEXT,
                failures_csv TEXT,
                history_csv TEXT,
                stdout TEXT,
                stderr TEXT,
                error TEXT,
                group_id TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS job_groups (
                group_id TEXT PRIMARY KEY,
                target_url TEXT,
                job_type TEXT,
                users INTEGER,
                spawn_rate INTEGER,
                duration_seconds INTEGER,
                child_count INTEGER,
                status TEXT,
                aggregated_stats_csv TEXT,
                aggregated_failures_csv TEXT,
                aggregated_history_csv TEXT,
                error TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT
            )
        """)
        # Safe to call repeatedly: ignore "duplicate column" if group_id already exists
        # from a database created before this feature was added.
        try:
            conn.execute("ALTER TABLE jobs ADD COLUMN group_id TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE jobs ADD COLUMN failures_csv TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE job_groups ADD COLUMN aggregated_failures_csv TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE jobs ADD COLUMN history_csv TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE job_groups ADD COLUMN aggregated_history_csv TEXT")
        except sqlite3.OperationalError:
            pass
        # 1 marks the run chosen as the baseline for its target_url.
        try:
            conn.execute("ALTER TABLE jobs ADD COLUMN is_baseline INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE job_groups ADD COLUMN is_baseline INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        _init_series_table(conn)
        # JSON list of request header NAMES sent with the run. Values are
        # never stored anywhere.
        try:
            conn.execute("ALTER TABLE jobs ADD COLUMN header_names TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE job_groups ADD COLUMN header_names TEXT")
        except sqlite3.OperationalError:
            pass
        # Extra per-run metadata stored as JSON text, added by later features.
        # Same defensive pattern: an existing database just gains the column.
        for table in ("jobs", "job_groups"):
            for column in RUN_META_COLUMNS:
                try:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT")
                except sqlite3.OperationalError:
                    pass


def create_job(job_id, target_url, users, spawn_rate, duration_seconds, group_id=None, header_names=None):
    """header_names: list of request header names (never their values)."""
    with _lock, _get_conn() as conn:
        conn.execute(
            """INSERT INTO jobs (job_id, target_url, users, spawn_rate, duration_seconds, status, group_id,
                                 header_names)
               VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)""",
            (job_id, target_url, users, spawn_rate, duration_seconds, group_id,
             json.dumps(header_names) if header_names else None),
        )


def update_job(job_id, **fields):
    if not fields:
        return
    with _lock, _get_conn() as conn:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [job_id]
        if "status" in fields and fields["status"] in FINISHED:
            set_clause += ", completed_at = CURRENT_TIMESTAMP"
        conn.execute(f"UPDATE jobs SET {set_clause} WHERE job_id = ?", values)


def get_job(job_id):
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        return dict(row) if row else None


def list_jobs(limit=50):
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT job_id, target_url, users, status, created_at, completed_at, is_baseline, slo, mode "
            "FROM jobs WHERE group_id IS NULL ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def create_job_group(group_id, target_url, job_type, users, spawn_rate, duration_seconds, child_count,
                     header_names=None):
    with _lock, _get_conn() as conn:
        conn.execute(
            """INSERT INTO job_groups
               (group_id, target_url, job_type, users, spawn_rate, duration_seconds, child_count, status,
                header_names)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)""",
            (group_id, target_url, job_type, users, spawn_rate, duration_seconds, child_count,
             json.dumps(header_names) if header_names else None),
        )


def update_job_group(group_id, **fields):
    if not fields:
        return
    with _lock, _get_conn() as conn:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [group_id]
        if "status" in fields and fields["status"] in FINISHED:
            set_clause += ", completed_at = CURRENT_TIMESTAMP"
        conn.execute(f"UPDATE job_groups SET {set_clause} WHERE group_id = ?", values)


def get_job_group(group_id):
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM job_groups WHERE group_id = ?", (group_id,)).fetchone()
        return dict(row) if row else None


def list_child_jobs(group_id):
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM jobs WHERE group_id = ? ORDER BY created_at ASC", (group_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def list_job_groups(limit=50):
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT group_id, target_url, users, status, created_at, completed_at, is_baseline, slo, mode "
            "FROM job_groups ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def set_baseline(run_id, target_url):
    """Makes run_id (a job id or a group id) the only baseline for target_url."""
    with _lock, _get_conn() as conn:
        conn.execute("UPDATE jobs SET is_baseline = 0 WHERE target_url = ?", (target_url,))
        conn.execute("UPDATE job_groups SET is_baseline = 0 WHERE target_url = ?", (target_url,))
        conn.execute("UPDATE jobs SET is_baseline = 1 WHERE job_id = ?", (run_id,))
        conn.execute("UPDATE job_groups SET is_baseline = 1 WHERE group_id = ?", (run_id,))


def get_baseline_id(target_url):
    """Returns the baseline run id for target_url, or None."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT group_id AS id FROM job_groups WHERE target_url = ? AND is_baseline = 1 "
            "UNION ALL "
            "SELECT job_id AS id FROM jobs WHERE target_url = ? AND is_baseline = 1 LIMIT 1",
            (target_url, target_url),
        ).fetchone()
        return row["id"] if row else None

# ---- Repeat series ------------------------------------------------------------
# A series runs the same configuration several times, one after another. Each
# repeat is an ordinary job or split group; the series only records their ids.

def _init_series_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS series (
            series_id TEXT PRIMARY KEY,
            target_url TEXT,
            job_type TEXT,
            users INTEGER,
            spawn_rate INTEGER,
            duration_seconds INTEGER,
            repeat_count INTEGER,
            run_ids TEXT,
            status TEXT,
            error TEXT,
            header_names TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT
        )
    """)


def create_series(series_id, target_url, job_type, users, spawn_rate, duration_seconds, repeat_count,
                  header_names=None):
    with _lock, _get_conn() as conn:
        conn.execute(
            """INSERT INTO series (series_id, target_url, job_type, users, spawn_rate, duration_seconds,
                                   repeat_count, run_ids, status, header_names)
               VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'queued', ?)""",
            (series_id, target_url, job_type, users, spawn_rate, duration_seconds, repeat_count,
             json.dumps(header_names) if header_names else None),
        )


def update_series(series_id, **fields):
    if not fields:
        return
    with _lock, _get_conn() as conn:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [series_id]
        if fields.get("status") in FINISHED:
            set_clause += ", completed_at = CURRENT_TIMESTAMP"
        conn.execute(f"UPDATE series SET {set_clause} WHERE series_id = ?", values)


def get_series(series_id):
    """The series row with run_ids (and header_names) decoded, or None."""
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM series WHERE series_id = ?", (series_id,)).fetchone()
    if not row:
        return None
    series = dict(row)
    series["run_ids"] = json.loads(series["run_ids"] or "[]")
    if series.get("header_names"):
        series["header_names"] = json.loads(series["header_names"])
    return series


# ---- Active and interrupted runs ------------------------------------------------

def list_active_runs():
    """Ids of runs whose stored status is queued or running:
    {"jobs": [single job ids, not children of a group],
     "groups": [group ids], "series": [(series id, [run ids])]}."""
    marks = ",".join("?" * len(IN_PROGRESS))
    with _get_conn() as conn:
        jobs = [r["job_id"] for r in conn.execute(
            f"SELECT job_id FROM jobs WHERE group_id IS NULL AND status IN ({marks})", IN_PROGRESS)]
        groups = [r["group_id"] for r in conn.execute(
            f"SELECT group_id FROM job_groups WHERE status IN ({marks})", IN_PROGRESS)]
        series = [(r["series_id"], json.loads(r["run_ids"] or "[]")) for r in conn.execute(
            f"SELECT series_id, run_ids FROM series WHERE status IN ({marks})", IN_PROGRESS)]
    return {"jobs": jobs, "groups": groups, "series": series}


INTERRUPTED_REASON = ("The backend stopped while this run was in progress (restart or crash), "
                      "so it never finished. Start it again.")


def mark_interrupted_runs():
    """Called once when the backend starts: any job, group or series still
    queued or running belonged to a previous process that is gone, so it can
    never finish. Marks them "interrupted" and returns how many of each."""
    marks = ",".join("?" * len(IN_PROGRESS))
    counts = {}
    with _lock, _get_conn() as conn:
        for table in ("jobs", "job_groups", "series"):
            cur = conn.execute(
                f"UPDATE {table} SET status = 'interrupted', error = ?, completed_at = CURRENT_TIMESTAMP "
                f"WHERE status IN ({marks})",
                (INTERRUPTED_REASON, *IN_PROGRESS),
            )
            counts[table] = cur.rowcount
    return counts
