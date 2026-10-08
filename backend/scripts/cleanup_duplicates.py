import asyncio
import os
import sys

from sqlalchemy import select
from sqlalchemy.orm import selectinload

# Add parent directory to path so we can import app modules
from app.db.session import get_session_factory
from app.models.project import Project
from app.models.endpoint import Endpoint
from app.models.discovery_run import DiscoveryRun


async def cleanup_duplicates():
    print("Starting duplicate project cleanup...")
    factory = get_session_factory()
    async with factory() as session:
        # Get all projects
        result = await session.execute(select(Project).order_by(Project.created_at.asc()))
        projects = result.scalars().all()
        
        seen_urls = {}
        duplicates = []
        
        for project in projects:
            if project.url in seen_urls:
                duplicates.append(project)
            else:
                seen_urls[project.url] = project
                
        if not duplicates:
            print("No duplicate projects found.")
            return
            
        print(f"Found {len(duplicates)} duplicate project(s).")
        
        for duplicate in duplicates:
            original = seen_urls[duplicate.url]
            print(f"Deleting duplicate '{duplicate.name}' ({duplicate.id}) for URL '{duplicate.url}'")
            print(f"  Keeping original '{original.name}' ({original.id})")
            
            # Delete duplicate project and cascade should handle endpoints/runs
            # But let's be safe and delete them explicitly if no cascade
            await session.execute(Endpoint.__table__.delete().where(Endpoint.project_id == str(duplicate.id)))
            await session.execute(DiscoveryRun.__table__.delete().where(DiscoveryRun.project_id == str(duplicate.id)))
            await session.delete(duplicate)
            
        await session.commit()
        print("Cleanup completed successfully.")


if __name__ == "__main__":
    asyncio.run(cleanup_duplicates())
