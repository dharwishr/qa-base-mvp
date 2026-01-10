"""Add source_action_id to run_steps for execute-analysis mapping.

Enables linking RunStep (execute tab) to StepAction (analysis) by storing
the source action ID. This allows highlighting the corresponding analysis
action when clicking on an execute step.

Revision ID: add_source_action_id
Revises: add_action_screenshot
Create Date: 2026-01-12 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers
revision = 'add_source_action_id'
down_revision = 'add_action_screenshot'
branch_labels = None
depends_on = None


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    # Add source_action_id column to run_steps table
    if not column_exists('run_steps', 'source_action_id'):
        op.add_column('run_steps', sa.Column('source_action_id', sa.String(36), nullable=True))


def downgrade() -> None:
    # Remove source_action_id column from run_steps table
    if column_exists('run_steps', 'source_action_id'):
        op.drop_column('run_steps', 'source_action_id')
