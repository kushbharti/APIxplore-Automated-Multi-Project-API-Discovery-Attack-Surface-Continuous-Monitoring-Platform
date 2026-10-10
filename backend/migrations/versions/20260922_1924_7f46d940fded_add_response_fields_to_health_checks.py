"""Add response capture fields to health_checks table.

Adds: response_body, response_headers (JSON), content_type, response_size_bytes
All columns are nullable so existing rows are unaffected.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7f46d940fded'
down_revision = '20260920_github_source'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('health_checks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('response_body', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('response_headers', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('content_type', sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column('response_size_bytes', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('health_checks', schema=None) as batch_op:
        batch_op.drop_column('response_size_bytes')
        batch_op.drop_column('content_type')
        batch_op.drop_column('response_headers')
        batch_op.drop_column('response_body')
