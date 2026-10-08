import sqlite3
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()
tables = c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print("Existing tables:", [t[0] for t in tables])
for t in ['discovery_candidates', 'discovery_runs', 'projects']:
    c.execute(f'DROP TABLE IF EXISTS {t}')
    print(f'Dropped {t}')
# Also remove the alembic version record for our new migration
c.execute("DELETE FROM alembic_version WHERE version_num='20260902_add_projects_and_discovery'")
conn.commit()
conn.close()
print("Done")
