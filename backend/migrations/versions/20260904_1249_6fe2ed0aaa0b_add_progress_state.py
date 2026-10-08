"""Alembic migration script template."""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6fe2ed0aaa0b'
down_revision = '20260902_add_projects_and_discovery'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('discovery_runs', sa.Column('progress_state', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('discovery_runs') as batch_op:
        batch_op.drop_column('progress_state')
