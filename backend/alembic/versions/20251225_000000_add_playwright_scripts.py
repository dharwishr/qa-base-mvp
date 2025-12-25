"""Add Playwright scripts and test runs tables

Revision ID: 8747521d0004
Revises: 8747521d0003
Create Date: 2025-12-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '8747521d0004'
down_revision = '8747521d0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create playwright_scripts table
    op.create_table(
        'playwright_scripts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('session_id', sa.String(36), sa.ForeignKey('test_sessions.id'), nullable=False),
        sa.Column('name', sa.String(256), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('steps_json', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('ix_playwright_scripts_session_id', 'playwright_scripts', ['session_id'])
    op.create_index('ix_playwright_scripts_name', 'playwright_scripts', ['name'])

    # Create test_runs table
    op.create_table(
        'test_runs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('script_id', sa.String(36), sa.ForeignKey('playwright_scripts.id'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('total_steps', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('passed_steps', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('failed_steps', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('healed_steps', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_test_runs_script_id', 'test_runs', ['script_id'])
    op.create_index('ix_test_runs_status', 'test_runs', ['status'])

    # Create run_steps table
    op.create_table(
        'run_steps',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('run_id', sa.String(36), sa.ForeignKey('test_runs.id'), nullable=False),
        sa.Column('step_index', sa.Integer(), nullable=False),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('selector_used', sa.Text(), nullable=True),
        sa.Column('screenshot_path', sa.String(512), nullable=True),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('heal_attempts', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_run_steps_run_id', 'run_steps', ['run_id'])


def downgrade() -> None:
    op.drop_table('run_steps')
    op.drop_table('test_runs')
    op.drop_table('playwright_scripts')
