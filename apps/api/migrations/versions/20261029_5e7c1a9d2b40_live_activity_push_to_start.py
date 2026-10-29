"""live activity push to start

Revision ID: 5e7c1a9d2b40
Revises: d9b83d570d48
Create Date: 2026-10-29 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '5e7c1a9d2b40'
down_revision: Union[str, Sequence[str], None] = 'd9b83d570d48'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'follows',
        sa.Column('live_activity', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.drop_constraint(op.f('ck_push_tokens_type_valid'), 'push_tokens', type_='check')
    op.create_check_constraint(
        op.f('ck_push_tokens_type_valid'),
        'push_tokens',
        "type IN ('expo', 'liveactivity', 'liveactivity_start')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM push_tokens WHERE type = 'liveactivity_start'")
    op.drop_constraint(op.f('ck_push_tokens_type_valid'), 'push_tokens', type_='check')
    op.create_check_constraint(
        op.f('ck_push_tokens_type_valid'),
        'push_tokens',
        "type IN ('expo', 'liveactivity')",
    )
    op.drop_column('follows', 'live_activity')
