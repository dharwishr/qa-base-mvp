"""Add screenshot_path column to step_actions table.

Allows storing per-action screenshots in test case analysis. Each action
in a step can now have its own screenshot captured immediately after execution.

Revision ID: add_action_screenshot
Revises: add_browser_session_logs
Create Date: 2026-01-11 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers
revision = 'add_action_screenshot'
down_revision = 'add_browser_session_logs'
branch_labels = None
depends_on = None


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    # Add screenshot_path column to step_actions table
    if not column_exists('step_actions', 'screenshot_path'):
        op.add_column('step_actions', sa.Column('screenshot_path', sa.String(512), nullable=True))


def downgrade() -> None:
    # Remove screenshot_path column from step_actions table
    if column_exists('step_actions', 'screenshot_path'):
        op.drop_column('step_actions', 'screenshot_path')
