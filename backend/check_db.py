import asyncio
from sqlalchemy import text
from app.db.session import get_engine

async def main():
    engine = get_engine()
    async with engine.connect() as conn:
        print("Connected to:", engine.url.render_as_string(hide_password=True))
        tables = await conn.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        ))
        print("Tables:", [r[0] for r in tables.fetchall()])
        ver = await conn.execute(text("SELECT version_num FROM alembic_version"))
        print("Alembic version:", [r[0] for r in ver.fetchall()])

if __name__ == "__main__":
    asyncio.run(main())
