"""Add browser_session_logs table.

Creates the browser_session_logs table to track who started each browser docker
session during test case analysis. This provides an audit trail and allows viewing
historical browser session data with user and organization information.

Revision ID: add_browser_session_logs
Revises: add_run_step_details
Create Date: 2026-01-10 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers
revision = 'add_browser_session_logs'
down_revision = 'add_run_step_details'
branch_labels = None
depends_on = None


def table_exists(table_name: str) -> bool:
    """Check if a table exists in the database."""
    bind = op.get_bind()
    inspector = inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    # Create browser_session_logs table (skip if already exists)
    if not table_exists('browser_session_logs'):
        op.create_table(
            'browser_session_logs',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('session_id', sa.String(36), nullable=False, unique=True, index=True),  # Browser session ID from orchestrator
            sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('phase', sa.String(20), nullable=False),  # analysis | execution
            sa.Column('status', sa.String(20), nullable=False, server_default='started'),  # started | ready | stopped | error
            sa.Column('container_id', sa.String(100), nullable=True),
            sa.Column('container_name', sa.String(200), nullable=True),
            sa.Column('test_session_id', sa.String(36), sa.ForeignKey('test_sessions.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('test_run_id', sa.String(36), sa.ForeignKey('test_runs.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('started_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column('stopped_at', sa.DateTime, nullable=True),
            sa.Column('error_message', sa.Text, nullable=True),
        )


def downgrade() -> None:
    # Drop browser_session_logs table
    if table_exists('browser_session_logs'):
        op.drop_table('browser_session_logs')
