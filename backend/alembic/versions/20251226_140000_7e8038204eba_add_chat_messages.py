"""add_chat_messages

Revision ID: 7e8038204eba
Revises: acb7ba46c261
Create Date: 2025-12-26 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7e8038204eba'
down_revision: Union[str, None] = 'acb7ba46c261'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create chat_messages table
    op.create_table(
        'chat_messages',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('session_id', sa.String(36), sa.ForeignKey('test_sessions.id'), nullable=False),
        sa.Column('message_type', sa.String(20), nullable=False),
        sa.Column('content', sa.Text, nullable=True),
        sa.Column('mode', sa.String(10), nullable=True),
        sa.Column('sequence_number', sa.Integer, nullable=False),
        sa.Column('plan_id', sa.String(36), sa.ForeignKey('test_plans.id'), nullable=True),
        sa.Column('step_id', sa.String(36), sa.ForeignKey('test_steps.id'), nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index('ix_chat_messages_session_id', 'chat_messages', ['session_id'])
    op.create_index('ix_chat_messages_sequence', 'chat_messages', ['session_id', 'sequence_number'])

    # Add approval fields to test_plans
    op.add_column('test_plans', sa.Column('approval_status', sa.String(20), nullable=False, server_default='pending'))
    op.add_column('test_plans', sa.Column('approval_timestamp', sa.DateTime, nullable=True))
    op.add_column('test_plans', sa.Column('rejection_reason', sa.Text, nullable=True))


def downgrade() -> None:
    # Remove approval fields from test_plans
    op.drop_column('test_plans', 'rejection_reason')
    op.drop_column('test_plans', 'approval_timestamp')
    op.drop_column('test_plans', 'approval_status')

    # Drop chat_messages table
    op.drop_index('ix_chat_messages_sequence', table_name='chat_messages')
    op.drop_index('ix_chat_messages_session_id', table_name='chat_messages')
    op.drop_table('chat_messages')
