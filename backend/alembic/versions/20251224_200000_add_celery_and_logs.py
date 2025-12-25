"""add_celery_and_logs

Revision ID: 8747521d0003
Revises: 8747521d0002
Create Date: 2025-12-24 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8747521d0003'
down_revision: Union[str, None] = '8747521d0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add celery_task_id column to test_sessions table
    op.add_column('test_sessions', sa.Column('celery_task_id', sa.String(length=50), nullable=True))

    # Create execution_logs table
    op.create_table(
        'execution_logs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=False),
        sa.Column('level', sa.String(length=20), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('source', sa.String(length=100), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['session_id'], ['test_sessions.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_execution_logs_session_id'), 'execution_logs', ['session_id'], unique=False)
    op.create_index(op.f('ix_execution_logs_level'), 'execution_logs', ['level'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_execution_logs_level'), table_name='execution_logs')
    op.drop_index(op.f('ix_execution_logs_session_id'), table_name='execution_logs')
    op.drop_table('execution_logs')
    op.drop_column('test_sessions', 'celery_task_id')
