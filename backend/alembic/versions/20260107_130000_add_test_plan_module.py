"""Add Test Plan module tables.

Creates tables for the new Test Plan feature:
- test_plans: Main test plan entity with run configuration
- test_plan_test_cases: Junction table linking plans to test sessions
- test_plan_runs: Execution history for test plan runs
- test_plan_run_results: Per-test-case results within a run
- test_plan_schedules: Scheduling configuration for automated runs

Revision ID: add_test_plan_module
Revises: rename_test_plans_01
Create Date: 2026-01-07 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers
revision = 'add_test_plan_module'
down_revision = 'rename_test_plans_01'
branch_labels = None
depends_on = None


def table_exists(table_name: str) -> bool:
    """Check if a table exists in the database."""
    bind = op.get_bind()
    inspector = inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    # Create test_plans table (skip if already exists)
    if not table_exists('test_plans'):
        op.create_table(
            'test_plans',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('name', sa.String(256), nullable=False),
            sa.Column('url', sa.String(2048), nullable=True),
            sa.Column('description', sa.Text, nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='active'),  # active | archived
            # Default Run Settings
            sa.Column('default_run_type', sa.String(20), nullable=False, server_default='sequential'),  # sequential | parallel
            sa.Column('browser_type', sa.String(20), nullable=False, server_default='chromium'),  # chromium | firefox | webkit | edge
            sa.Column('resolution_width', sa.Integer, nullable=False, server_default='1920'),
            sa.Column('resolution_height', sa.Integer, nullable=False, server_default='1080'),
            sa.Column('headless', sa.Boolean, nullable=False, server_default='1'),
            sa.Column('screenshots_enabled', sa.Boolean, nullable=False, server_default='1'),
            sa.Column('recording_enabled', sa.Boolean, nullable=False, server_default='1'),
            sa.Column('network_recording_enabled', sa.Boolean, nullable=False, server_default='0'),
            sa.Column('performance_metrics_enabled', sa.Boolean, nullable=False, server_default='1'),
            # Timestamps
            sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
        )

    # Create test_plan_test_cases junction table
    if not table_exists('test_plan_test_cases'):
        op.create_table(
            'test_plan_test_cases',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('test_plan_id', sa.String(36), sa.ForeignKey('test_plans.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('test_session_id', sa.String(36), sa.ForeignKey('test_sessions.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('order', sa.Integer, nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
            # Unique constraint to prevent duplicates
            sa.UniqueConstraint('test_plan_id', 'test_session_id', name='uq_test_plan_test_case'),
        )

    # Create test_plan_runs table
    if not table_exists('test_plan_runs'):
        op.create_table(
            'test_plan_runs',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('test_plan_id', sa.String(36), sa.ForeignKey('test_plans.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('celery_task_id', sa.String(50), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='pending'),  # pending | running | passed | failed | cancelled
            sa.Column('run_type', sa.String(20), nullable=False, server_default='sequential'),  # sequential | parallel
            # Run Configuration (copied from test plan or overridden)
            sa.Column('browser_type', sa.String(20), nullable=False, server_default='chromium'),
            sa.Column('resolution_width', sa.Integer, nullable=False, server_default='1920'),
            sa.Column('resolution_height', sa.Integer, nullable=False, server_default='1080'),
            sa.Column('headless', sa.Boolean, nullable=False, server_default='1'),
            sa.Column('screenshots_enabled', sa.Boolean, nullable=False, server_default='1'),
            sa.Column('recording_enabled', sa.Boolean, nullable=False, server_default='1'),
            sa.Column('network_recording_enabled', sa.Boolean, nullable=False, server_default='0'),
            sa.Column('performance_metrics_enabled', sa.Boolean, nullable=False, server_default='1'),
            # Stats
            sa.Column('total_test_cases', sa.Integer, nullable=False, server_default='0'),
            sa.Column('passed_test_cases', sa.Integer, nullable=False, server_default='0'),
            sa.Column('failed_test_cases', sa.Integer, nullable=False, server_default='0'),
            sa.Column('duration_ms', sa.Integer, nullable=True),
            sa.Column('started_at', sa.DateTime, nullable=True),
            sa.Column('completed_at', sa.DateTime, nullable=True),
            sa.Column('error_message', sa.Text, nullable=True),
            sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        )

    # Create test_plan_run_results table
    if not table_exists('test_plan_run_results'):
        op.create_table(
            'test_plan_run_results',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('test_plan_run_id', sa.String(36), sa.ForeignKey('test_plan_runs.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('test_session_id', sa.String(36), sa.ForeignKey('test_sessions.id', ondelete='SET NULL'), nullable=True),
            sa.Column('test_run_id', sa.String(36), sa.ForeignKey('test_runs.id', ondelete='SET NULL'), nullable=True),
            sa.Column('order', sa.Integer, nullable=False, server_default='0'),
            sa.Column('status', sa.String(20), nullable=False, server_default='pending'),  # pending | running | passed | failed | skipped
            sa.Column('duration_ms', sa.Integer, nullable=True),
            sa.Column('error_message', sa.Text, nullable=True),
            sa.Column('started_at', sa.DateTime, nullable=True),
            sa.Column('completed_at', sa.DateTime, nullable=True),
        )

    # Create test_plan_schedules table
    if not table_exists('test_plan_schedules'):
        op.create_table(
            'test_plan_schedules',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('test_plan_id', sa.String(36), sa.ForeignKey('test_plans.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('name', sa.String(256), nullable=False),
            sa.Column('schedule_type', sa.String(20), nullable=False),  # one_time | recurring
            sa.Column('run_type', sa.String(20), nullable=False, server_default='sequential'),  # sequential | parallel
            sa.Column('one_time_at', sa.DateTime, nullable=True),
            sa.Column('cron_expression', sa.String(100), nullable=True),
            sa.Column('timezone', sa.String(50), nullable=False, server_default='UTC'),
            sa.Column('is_active', sa.Boolean, nullable=False, server_default='1'),
            sa.Column('last_run_at', sa.DateTime, nullable=True),
            sa.Column('next_run_at', sa.DateTime, nullable=True),
            sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
        )


def downgrade() -> None:
    if table_exists('test_plan_schedules'):
        op.drop_table('test_plan_schedules')
    if table_exists('test_plan_run_results'):
        op.drop_table('test_plan_run_results')
    if table_exists('test_plan_runs'):
        op.drop_table('test_plan_runs')
    if table_exists('test_plan_test_cases'):
        op.drop_table('test_plan_test_cases')
    if table_exists('test_plans'):
        op.drop_table('test_plans')
