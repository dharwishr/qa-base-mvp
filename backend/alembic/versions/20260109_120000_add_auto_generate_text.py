"""Add auto_generate_text column to step_actions.

Adds a boolean flag to step_actions that indicates whether the input text
should be auto-generated at runtime instead of using the stored value.

Revision ID: add_auto_generate_text
Revises: add_pause_context
Create Date: 2026-01-09 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'add_auto_generate_text'
down_revision = 'add_pause_context'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add auto_generate_text column to step_actions with default False
    op.add_column('step_actions', sa.Column('auto_generate_text', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('step_actions', 'auto_generate_text')
