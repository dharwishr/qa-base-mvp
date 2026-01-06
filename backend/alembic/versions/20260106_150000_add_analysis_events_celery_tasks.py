"""add_analysis_events_and_celery_task_ids

Revision ID: a1b2c3d4e5f6
Revises: 8f22856dc35f
Create Date: 2026-01-06 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '8f22856dc35f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create analysis_events table for persistent event logging
    op.create_table('analysis_events',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=False),
        sa.Column('event_type', sa.String(length=50), nullable=False),
        sa.Column('event_data', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['test_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_analysis_events_session_id'), 'analysis_events', ['session_id'], unique=False)
    op.create_index(op.f('ix_analysis_events_created_at'), 'analysis_events', ['created_at'], unique=False)

    # Add plan_task_id and execution_task_id to test_sessions for Celery task tracking
    op.add_column('test_sessions', sa.Column('plan_task_id', sa.String(length=50), nullable=True))
    op.add_column('test_sessions', sa.Column('execution_task_id', sa.String(length=50), nullable=True))


def downgrade() -> None:
    # Remove task ID columns from test_sessions
    op.drop_column('test_sessions', 'execution_task_id')
    op.drop_column('test_sessions', 'plan_task_id')

    # Drop analysis_events table
    op.drop_index(op.f('ix_analysis_events_created_at'), table_name='analysis_events')
    op.drop_index(op.f('ix_analysis_events_session_id'), table_name='analysis_events')
    op.drop_table('analysis_events')
