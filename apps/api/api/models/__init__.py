"""SQLAlchemy models. Import every model module here so Alembic sees them."""

from api.models.base import Base

__all__ = ["Base"]
