"""add_session_runs_support

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-01-06 16:00:00.000000

Adds support for running test actions directly from sessions without generating PlaywrightScript.
- Adds is_enabled field to step_actions for selective action execution
- Makes script_id nullable in test_runs (can run from session instead)
- Adds session_id foreign key to test_runs
- Adds celery_task_id to test_runs for tracking async execution
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6g7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    # Add is_enabled column to step_actions (default True) - only if it doesn't exist
    if not column_exists('step_actions', 'is_enabled'):
        op.add_column('step_actions', sa.Column('is_enabled', sa.Boolean(), nullable=False, server_default='1'))

    # Backfill: ensure all existing records have is_enabled = True
    # This handles any NULL values that might exist
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE step_actions SET is_enabled = 1 WHERE is_enabled IS NULL OR is_enabled = 0"))

    # Check which columns need to be added to test_runs
    needs_session_id = not column_exists('test_runs', 'session_id')
    needs_celery_task_id = not column_exists('test_runs', 'celery_task_id')

    # For SQLite, we need to use batch mode to alter columns
    # This recreates the table with the new schema
    with op.batch_alter_table('test_runs', schema=None) as batch_op:
        # Make script_id nullable (to allow session-based runs)
        batch_op.alter_column('script_id',
                              existing_type=sa.String(length=36),
                              nullable=True)
        # Add session_id column if it doesn't exist
        if needs_session_id:
            batch_op.add_column(sa.Column('session_id', sa.String(length=36), nullable=True))
        # Add celery_task_id column if it doesn't exist
        if needs_celery_task_id:
            batch_op.add_column(sa.Column('celery_task_id', sa.String(length=50), nullable=True))

    # Create index if session_id was added
    if needs_session_id:
        # Check if index exists first
        bind = op.get_bind()
        inspector = inspect(bind)
        indexes = [idx['name'] for idx in inspector.get_indexes('test_runs')]
        if 'ix_test_runs_session_id' not in indexes:
            op.create_index(op.f('ix_test_runs_session_id'), 'test_runs', ['session_id'], unique=False)


def downgrade() -> None:
    # Check if index exists before dropping
    bind = op.get_bind()
    inspector = inspect(bind)
    indexes = [idx['name'] for idx in inspector.get_indexes('test_runs')]
    if 'ix_test_runs_session_id' in indexes:
        op.drop_index(op.f('ix_test_runs_session_id'), table_name='test_runs')

    # Use batch mode to reverse changes
    with op.batch_alter_table('test_runs', schema=None) as batch_op:
        if column_exists('test_runs', 'celery_task_id'):
            batch_op.drop_column('celery_task_id')
        if column_exists('test_runs', 'session_id'):
            batch_op.drop_column('session_id')
        # Make script_id non-nullable again (this may fail if there are session-based runs)
        batch_op.alter_column('script_id',
                              existing_type=sa.String(length=36),
                              nullable=False)

    # Remove is_enabled from step_actions
    if column_exists('step_actions', 'is_enabled'):
        op.drop_column('step_actions', 'is_enabled')
