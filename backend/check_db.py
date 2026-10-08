import sqlite3
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()
tables = c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print("Tables:", [t[0] for t in tables])
# Show endpoint columns
cols = c.execute("PRAGMA table_info(endpoints)").fetchall()
print("\nEndpoint columns:", [(col[1], col[2]) for col in cols])
ver = c.execute("SELECT * FROM alembic_version").fetchall()
print("\nAlembic version:", ver)
conn.close()
