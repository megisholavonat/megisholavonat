"""Trained delay forecast models"""

from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, Integer, LargeBinary, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base


class DelayForecastModel(Base):
    """
    One row per training run. Every process serves the row with the highest
    id among the format versions it understands; `artifact` is the npz written
    by api.forecast.model.ForecastModel (LightGBM JSON dump plus history).
    """

    __tablename__ = "delay_forecast_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Bumped when the artifact layout or the feature set changes; workers
    # ignore models of another format
    format_version: Mapped[int] = mapped_column(Integer)
    # Feature names in model input order
    features: Mapped[list[str]] = mapped_column(JSONB)
    # Service dates the final model was trained on
    trained_from: Mapped[date] = mapped_column(Date)
    trained_to: Mapped[date] = mapped_column(Date)
    # Holdout evaluation, training parameters and sizes
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB)
    artifact: Mapped[bytes] = mapped_column(LargeBinary)
