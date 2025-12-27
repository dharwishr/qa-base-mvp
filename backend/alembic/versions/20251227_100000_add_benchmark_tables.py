"""add_benchmark_tables

Revision ID: b1c2d3e4f5a6
Revises: 67eeac06703b
Create Date: 2025-12-27 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = '67eeac06703b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create benchmark_sessions table
    op.create_table('benchmark_sessions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('prompt', sa.Text(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=True),
        sa.Column('selected_models', sa.JSON(), nullable=False),
        sa.Column('headless', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # Create benchmark_model_runs table
    op.create_table('benchmark_model_runs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('benchmark_session_id', sa.String(length=36), nullable=False),
        sa.Column('llm_model', sa.String(length=50), nullable=False),
        sa.Column('test_session_id', sa.String(length=36), nullable=True),
        sa.Column('celery_task_id', sa.String(length=50), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('total_steps', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('duration_seconds', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['benchmark_session_id'], ['benchmark_sessions.id'], ),
        sa.ForeignKeyConstraint(['test_session_id'], ['test_sessions.id'], ),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('benchmark_model_runs')
    op.drop_table('benchmark_sessions')
