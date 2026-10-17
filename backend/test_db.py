import asyncio
from sqlalchemy import text
from app.db.session import get_engine

async def test():
    try:
        engine = get_engine()
        async with engine.begin() as conn:
            res = await conn.execute(text("SELECT 1"))
            print("NeonDB Connection Success:", res.scalar())
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test())
