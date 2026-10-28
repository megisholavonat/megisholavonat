"""add delay forecast models

Revision ID: d9b83d570d48
Revises: bd531f4476fc
Create Date: 2026-10-29 00:26:56.142654

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd9b83d570d48'
down_revision: Union[str, Sequence[str], None] = 'bd531f4476fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('delay_forecast_models',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('format_version', sa.Integer(), nullable=False),
    sa.Column('trained_from', sa.Date(), nullable=False),
    sa.Column('trained_to', sa.Date(), nullable=False),
    sa.Column('metrics', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('artifact', sa.LargeBinary(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_delay_forecast_models'))
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('delay_forecast_models')
