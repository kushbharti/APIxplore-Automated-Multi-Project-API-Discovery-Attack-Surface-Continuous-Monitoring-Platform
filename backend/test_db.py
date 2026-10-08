import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
engine = create_async_engine('postgresql+asyncpg://postgres:postgres@localhost:5432/api_observability')
async def test():
    try:
        async with engine.begin() as conn:
            pass
        print('Success')
    except Exception as e:
        print(f"Error: {e}")
asyncio.run(test())
