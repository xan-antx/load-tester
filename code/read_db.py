import sqlite3

conn = sqlite3.connect("load_tests.db")
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT job_id, target_url, users, status, created_at FROM jobs ORDER BY created_at DESC").fetchall()

for row in rows:
    print(dict(row))

conn.close()