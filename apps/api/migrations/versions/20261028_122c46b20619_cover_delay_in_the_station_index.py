"""cover delay in the station index

Revision ID: 122c46b20619
Revises: b68d17bcf067
Create Date: 2026-10-28 23:22:15.102736

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '122c46b20619'
down_revision: Union[str, Sequence[str], None] = 'b68d17bcf067'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEX = 'ix_stop_delay_observations_station_id_service_date'
TABLE = 'stop_delay_observations'


def upgrade() -> None:
    """Upgrade schema."""
    # Station aggregates (rankings) can then use an index-only scan
    op.drop_index(INDEX, table_name=TABLE)
    op.create_index(
        INDEX,
        TABLE,
        ['station_id', 'service_date'],
        unique=False,
        postgresql_include=['delay_s'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(INDEX, table_name=TABLE)
    op.create_index(INDEX, TABLE, ['station_id', 'service_date'], unique=False)
