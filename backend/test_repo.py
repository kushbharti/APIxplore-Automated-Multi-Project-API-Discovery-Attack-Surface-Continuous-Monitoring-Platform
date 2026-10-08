import asyncio
from app.db.session import get_session_factory
from app.repositories.project import ProjectRepository
from sqlalchemy.exc import OperationalError
import uuid

async def test():
    factory = get_session_factory()
    async with factory() as session:
        repo = ProjectRepository(session)
        try:
            p = await repo.get_by_id(uuid.UUID('c6d91637-acac-4b43-bfd2-f015161c93be'))
            print("Project:", p)
        except Exception as e:
            print("Exception:", type(e), str(e))

asyncio.run(test())
