"""Delay history tables"""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base

# A train counts as on time when it is at most this late
ON_TIME_THRESHOLD_S = 5 * 60


class Stop(Base):
    __tablename__ = "stops"

    # Platform-level stop, e.g. 1:005501024_14
    gtfs_id: Mapped[str] = mapped_column(Text, primary_key=True)
    # UIC station code, e.g. 005501024 (shared by all platforms of a station)
    station_id: Mapped[str] = mapped_column(Text, index=True)
    name: Mapped[str] = mapped_column(Text)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    county: Mapped[str | None] = mapped_column(Text)


class StopDelayObservation(Base):
    """
    One row per trip and stop, written when the train is first seen past the
    stop. Range-partitioned by month on service_date; partitions are created
    at runtime (see api.services.history.ensure_partition).
    """

    __tablename__ = "stop_delay_observations"
    __table_args__ = (
        Index(
            "ix_stop_delay_observations_station_id_service_date",
            "station_id",
            "service_date",
        ),
        {"postgresql_partition_by": "RANGE (service_date)"},
    )

    service_date: Mapped[date] = mapped_column(Date, primary_key=True)
    trip_gtfs_id: Mapped[str] = mapped_column(Text, primary_key=True)
    # 0-based position in the trip's stoptimes
    stop_sequence: Mapped[int] = mapped_column(Integer, primary_key=True)
    # GTFS stop_sequence (OTP stopPosition); not consecutive, absent in old data
    gtfs_stop_sequence: Mapped[int | None] = mapped_column(Integer)
    trip_short_name: Mapped[str] = mapped_column(Text)
    route_short_name: Mapped[str] = mapped_column(Text)
    # Platform-level stop; platform prediction needs it next to the station
    stop_id: Mapped[str] = mapped_column(Text, ForeignKey("stops.gtfs_id"))
    station_id: Mapped[str] = mapped_column(Text)
    # Seconds since local midnight of the service date, as OTP reports them
    scheduled_arrival_s: Mapped[int | None] = mapped_column(Integer)
    scheduled_departure_s: Mapped[int | None] = mapped_column(Integer)
    # Our GPS-derived delay when the stop was passed
    delay_s: Mapped[int] = mapped_column(Integer)
    # OTP's realtime - scheduled, kept for later modelling
    otp_arrival_delay_s: Mapped[int | None] = mapped_column(Integer)
    otp_departure_delay_s: Mapped[int | None] = mapped_column(Integer)
    platform: Mapped[str | None] = mapped_column(Text)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DelayDailyAgg(Base):
    """Per day, station and route rollup of stop_delay_observations. Kept forever."""

    __tablename__ = "delay_daily_agg"

    service_date: Mapped[date] = mapped_column(Date, primary_key=True)
    station_id: Mapped[str] = mapped_column(Text, primary_key=True)
    route_short_name: Mapped[str] = mapped_column(Text, primary_key=True)
    n: Mapped[int] = mapped_column(Integer)
    n_on_time: Mapped[int] = mapped_column(Integer)
    sum_delay_s: Mapped[int] = mapped_column(BigInteger)
    p90_delay_s: Mapped[int] = mapped_column(Integer)
    max_delay_s: Mapped[int] = mapped_column(Integer)
