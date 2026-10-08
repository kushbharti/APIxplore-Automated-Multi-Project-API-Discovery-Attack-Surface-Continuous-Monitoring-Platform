"""
Migration: Add github_checked to discovery_runs and source_type/deployment_url to projects.

Also adds AUTH_REQUIRED, WEB_PAGE, NOT_VERIFIED as allowed values for
discovery_candidates.verification_status (these are string columns, not
Postgres ENUM, so no schema change needed — just documenting).
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260920_github_and_source_type'
down_revision: str | None = '6fe2ed0aaa0b'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # ---------------------------------------------------------------------------
    # Add github_checked to discovery_runs
    # ---------------------------------------------------------------------------
    with op.batch_alter_table('discovery_runs') as batch_op:
        batch_op.add_column(
            sa.Column('github_checked', sa.Boolean(), nullable=False, server_default='0')
        )

    # ---------------------------------------------------------------------------
    # Add source_type and deployment_url to projects
    # ---------------------------------------------------------------------------
    with op.batch_alter_table('projects') as batch_op:
        batch_op.add_column(
            sa.Column('source_type', sa.String(30), nullable=False, server_default='WEBSITE')
        )
        batch_op.add_column(
            sa.Column('deployment_url', sa.String(2048), nullable=True)
        )

    # ---------------------------------------------------------------------------
    # Note: discovery_candidates.verification_status uses String(20) — the new
    # values WEB_PAGE (8 chars), AUTH_REQUIRED (13 chars), NOT_VERIFIED (12 chars)
    # all fit within 20 chars. No column alteration needed.
    # ---------------------------------------------------------------------------


def downgrade() -> None:
    with op.batch_alter_table('projects') as batch_op:
        batch_op.drop_column('deployment_url')
        batch_op.drop_column('source_type')

    with op.batch_alter_table('discovery_runs') as batch_op:
        batch_op.drop_column('github_checked')
