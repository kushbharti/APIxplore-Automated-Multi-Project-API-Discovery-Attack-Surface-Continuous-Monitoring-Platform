"""
New migration: add projects, discovery_runs, discovery_candidates tables,
and extend endpoints with project_id, discovery_source, confidence, path, last_checked_at.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20260902_add_projects_and_discovery'
down_revision: str | None = '24c3845eb8a6'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # ---------------------------------------------------------------------------
    # Create projects table
    # ---------------------------------------------------------------------------
    op.create_table(
        'projects',
        sa.Column('id', sa.String(36), nullable=False, primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('url', sa.String(2048), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='UNKNOWN'),
        sa.Column('health_score', sa.Float(), nullable=True),
        sa.Column('endpoint_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('healthy_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('degraded_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('down_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_projects_status', 'projects', ['status'])

    # ---------------------------------------------------------------------------
    # Create discovery_runs table
    # ---------------------------------------------------------------------------
    op.create_table(
        'discovery_runs',
        sa.Column('id', sa.String(36), nullable=False, primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='PENDING'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('openapi_checked', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('crawl_checked', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('js_checked', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('openapi_found', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('openapi_url', sa.String(2048), nullable=True),
        sa.Column('candidates_total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('candidates_verified', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('candidates_unavailable', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('candidates_blocked', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('provider_results', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_discovery_runs_project_id', 'discovery_runs', ['project_id'])
    op.create_index('ix_discovery_runs_status', 'discovery_runs', ['status'])

    # ---------------------------------------------------------------------------
    # Create discovery_candidates table
    # ---------------------------------------------------------------------------
    op.create_table(
        'discovery_candidates',
        sa.Column('id', sa.String(36), nullable=False, primary_key=True),
        sa.Column('run_id', sa.String(36), sa.ForeignKey('discovery_runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('method', sa.String(10), nullable=False, server_default='GET'),
        sa.Column('path', sa.String(2048), nullable=False),
        sa.Column('full_url', sa.String(2048), nullable=False),
        sa.Column('source', sa.String(20), nullable=False, server_default='CRAWLER'),
        sa.Column('confidence', sa.String(10), nullable=False, server_default='MEDIUM'),
        sa.Column('operation_id', sa.String(200), nullable=True),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('tags', sa.String(500), nullable=True),
        sa.Column('verification_status', sa.String(20), nullable=False, server_default='PENDING'),
        sa.Column('http_status', sa.Integer(), nullable=True),
        sa.Column('response_time_ms', sa.Float(), nullable=True),
        sa.Column('verification_error', sa.String(500), nullable=True),
        sa.Column('accepted', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('endpoint_id', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_discovery_candidates_run_id', 'discovery_candidates', ['run_id'])
    op.create_index('ix_discovery_candidates_project_id', 'discovery_candidates', ['project_id'])

    # ---------------------------------------------------------------------------
    # Extend endpoints table (using batch mode for SQLite FK compatibility)
    # ---------------------------------------------------------------------------
    with op.batch_alter_table('endpoints') as batch_op:
        batch_op.add_column(sa.Column('project_id', sa.String(36), nullable=True))
        batch_op.add_column(sa.Column('path', sa.String(2048), nullable=True))
        batch_op.add_column(sa.Column('discovery_source', sa.String(20), nullable=False, server_default='MANUAL'))
        batch_op.add_column(sa.Column('confidence', sa.String(10), nullable=False, server_default='HIGH'))
        batch_op.add_column(sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index('ix_endpoints_project_id', ['project_id'])



def downgrade() -> None:
    # Remove new endpoint columns
    op.drop_index('ix_endpoints_project_id', table_name='endpoints')
    op.drop_column('endpoints', 'last_checked_at')
    op.drop_column('endpoints', 'confidence')
    op.drop_column('endpoints', 'discovery_source')
    op.drop_column('endpoints', 'path')
    op.drop_column('endpoints', 'project_id')

    # Drop new tables
    op.drop_table('discovery_candidates')
    op.drop_table('discovery_runs')
    op.drop_table('projects')
