"""Add pause_context column to test_sessions.

Adds the pause_context JSON column to store AI agent context when
execution is paused, enabling resumption of AI execution.

Revision ID: add_pause_context
Revises: add_test_plan_module
Create Date: 2026-01-09 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'add_pause_context'
down_revision = 'add_test_plan_module'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add pause_context column to test_sessions
    op.add_column('test_sessions', sa.Column('pause_context', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('test_sessions', 'pause_context')
