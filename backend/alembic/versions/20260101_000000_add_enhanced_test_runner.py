"""Add enhanced test runner columns and tables.

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-01-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    # Drop existing tables if they exist (in case of partial migration)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'network_requests' in existing_tables:
        op.drop_table('network_requests')
    if 'console_logs' in existing_tables:
        op.drop_table('console_logs')
    if 'system_settings' in existing_tables:
        op.drop_table('system_settings')

    # Add new columns to test_runs table (skip if already exist)
    existing_columns = [col['name'] for col in inspector.get_columns('test_runs')]

    columns_to_add = [
        ('browser_type', sa.String(50), 'chromium'),
        ('resolution_width', sa.Integer(), '1920'),
        ('resolution_height', sa.Integer(), '1080'),
        ('screenshots_enabled', sa.Boolean(), '1'),
        ('recording_enabled', sa.Boolean(), '1'),
        ('network_recording_enabled', sa.Boolean(), '0'),
        ('performance_metrics_enabled', sa.Boolean(), '1'),
        ('video_path', sa.String(500), None),
        ('duration_ms', sa.Integer(), None),
        ('celery_task_id', sa.String(100), None),
    ]

    with op.batch_alter_table('test_runs', schema=None) as batch_op:
        for col_name, col_type, default in columns_to_add:
            if col_name not in existing_columns:
                batch_op.add_column(sa.Column(col_name, col_type, nullable=True, server_default=default))

    # Create network_requests table
    op.create_table(
        'network_requests',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('run_id', sa.String(36), sa.ForeignKey('test_runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('step_index', sa.Integer(), nullable=True),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('method', sa.String(20), nullable=False, server_default='GET'),
        sa.Column('resource_type', sa.String(50), nullable=True, server_default='other'),
        sa.Column('request_headers', sa.JSON(), nullable=True),
        sa.Column('request_body', sa.Text(), nullable=True),
        sa.Column('status_code', sa.Integer(), nullable=True),
        sa.Column('response_headers', sa.JSON(), nullable=True),
        sa.Column('response_size_bytes', sa.Integer(), nullable=True),
        sa.Column('timing_dns_ms', sa.Float(), nullable=True),
        sa.Column('timing_connect_ms', sa.Float(), nullable=True),
        sa.Column('timing_ssl_ms', sa.Float(), nullable=True),
        sa.Column('timing_ttfb_ms', sa.Float(), nullable=True),
        sa.Column('timing_download_ms', sa.Float(), nullable=True),
        sa.Column('timing_total_ms', sa.Float(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_network_requests_run_id', 'network_requests', ['run_id'])

    # Create console_logs table
    op.create_table(
        'console_logs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('run_id', sa.String(36), sa.ForeignKey('test_runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('step_index', sa.Integer(), nullable=True),
        sa.Column('level', sa.String(20), nullable=False, server_default='log'),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('source', sa.String(500), nullable=True),
        sa.Column('line_number', sa.Integer(), nullable=True),
        sa.Column('column_number', sa.Integer(), nullable=True),
        sa.Column('stack_trace', sa.Text(), nullable=True),
        sa.Column('timestamp', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_console_logs_run_id', 'console_logs', ['run_id'])

    # Create system_settings table
    op.create_table(
        'system_settings',
        sa.Column('id', sa.String(36), primary_key=True, server_default='default'),
        sa.Column('isolation_mode', sa.String(20), nullable=False, server_default='context'),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )


def downgrade():
    # Drop tables
    op.drop_table('system_settings')
    op.drop_index('ix_console_logs_run_id', 'console_logs')
    op.drop_table('console_logs')
    op.drop_index('ix_network_requests_run_id', 'network_requests')
    op.drop_table('network_requests')

    # Remove columns from test_runs
    with op.batch_alter_table('test_runs', schema=None) as batch_op:
        batch_op.drop_column('celery_task_id')
        batch_op.drop_column('duration_ms')
        batch_op.drop_column('video_path')
        batch_op.drop_column('performance_metrics_enabled')
        batch_op.drop_column('network_recording_enabled')
        batch_op.drop_column('recording_enabled')
        batch_op.drop_column('screenshots_enabled')
        batch_op.drop_column('resolution_height')
        batch_op.drop_column('resolution_width')
        batch_op.drop_column('browser_type')
