import asyncio
from app.db.session import get_session_factory
from app.repositories.discovery import DiscoveryRunRepository
from app.models.discovery_run import DiscoveryRun, DiscoveryStatus
import uuid

async def test():
    factory = get_session_factory()
    async with factory() as session:
        run = DiscoveryRun(
            project_id=str(uuid.UUID('c6d91637-acac-4b43-bfd2-f015161c93be')),
            status=DiscoveryStatus.PENDING.value,
        )
        repo = DiscoveryRunRepository(session)
        try:
            created = await repo.create(run)
            await session.commit()
            print("Created run:", created.id)
        except Exception as e:
            print("Exception:", type(e), str(e))

asyncio.run(test())
