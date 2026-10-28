"""Anonymous devices and the trains they follow"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base

PLATFORMS = ("web", "ios", "android")
FOLLOW_KINDS = ("trip", "commute")
PUSH_TOKEN_TYPES = ("expo", "liveactivity")

# "On time" means at most 5 minutes late, see ON_TIME_THRESHOLD_S
DEFAULT_DELAY_THRESHOLD_MIN = 5


class Device(Base):
    """An app install or browser. There are no accounts; the token is the key."""

    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint("platform IN ('web', 'ios', 'android')", name="platform_valid"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    # sha256 of the bearer token; the token itself is never stored
    token_hash: Mapped[bytes] = mapped_column(LargeBinary)
    platform: Mapped[str] = mapped_column(Text)
    locale: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Updated at most once a day; idle devices are deleted
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class Follow(Base):
    """
    A train a device follows: either one trip on one service date (`trip`), or
    a train it takes regularly on some weekdays (`commute`).
    """

    __tablename__ = "follows"
    __table_args__ = (
        CheckConstraint("kind IN ('trip', 'commute')", name="kind_valid"),
        CheckConstraint(
            "kind <> 'trip' OR (trip_id IS NOT NULL AND service_date IS NOT NULL)",
            name="trip_fields",
        ),
        # Train numbers repeat within a day, so a commute needs its boarding
        # station to pick the right trip
        CheckConstraint(
            "kind <> 'commute' OR (from_station_id IS NOT NULL"
            " AND weekdays BETWEEN 1 AND 127)",
            name="commute_fields",
        ),
        CheckConstraint(
            "delay_threshold_min BETWEEN 0 AND 240", name="delay_threshold_range"
        ),
        # NULLs are distinct, so this only constrains trip follows; it also
        # serves lookups by device_id
        UniqueConstraint("device_id", "trip_id", "service_date"),
        Index("ix_follows_kind_service_date", "kind", "service_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(Text)
    # Display name, e.g. "559 AGRIA InterRégió"; commutes match on the number
    trip_short_name: Mapped[str] = mapped_column(Text)

    # kind = trip: OTP trip gtfsId and its service date, optional
    # platform-level stops the device boards at and leaves at
    trip_id: Mapped[str | None] = mapped_column(Text)
    service_date: Mapped[date | None] = mapped_column(Date)
    from_stop_id: Mapped[str | None] = mapped_column(Text)
    to_stop_id: Mapped[str | None] = mapped_column(Text)

    # kind = commute: ISO weekday bitmask (bit 0 = Monday ... bit 6 = Sunday)
    # and UIC station codes, e.g. 005501024
    weekdays: Mapped[int | None] = mapped_column(SmallInteger)
    from_station_id: Mapped[str | None] = mapped_column(Text)
    to_station_id: Mapped[str | None] = mapped_column(Text)
    label: Mapped[str | None] = mapped_column(Text)

    alerts_enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    delay_threshold_min: Mapped[int] = mapped_column(
        SmallInteger, server_default=text(str(DEFAULT_DELAY_THRESHOLD_MIN))
    )
    notify_platform_change: Mapped[bool] = mapped_column(
        Boolean, server_default=text("true")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class NotificationState(Base):
    """What was last pushed for a follow on a service date (used by alerts)."""

    __tablename__ = "notification_state"

    follow_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("follows.id", ondelete="CASCADE"),
        primary_key=True,
    )
    service_date: Mapped[date] = mapped_column(Date, primary_key=True)
    last_delay_min: Mapped[int | None] = mapped_column(Integer)
    last_platform: Mapped[str | None] = mapped_column(Text)
    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The trip gtfsId the state is about; a commute resolving to another trip
    # on the same service date starts over
    trip_id: Mapped[str | None] = mapped_column(Text)
    # The "train ahead is late" hint goes out at most once per service date
    train_ahead_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )


class PushToken(Base):
    """
    Where a device receives pushes: an Expo push token (iOS and Android), or
    the ActivityKit push token of one followed trip's iOS Live Activity.
    """

    __tablename__ = "push_tokens"
    __table_args__ = (
        CheckConstraint("type IN ('expo', 'liveactivity')", name="type_valid"),
        CheckConstraint(
            "(type = 'liveactivity') = (follow_id IS NOT NULL)", name="follow_fields"
        ),
        # A token belongs to one device; registering it again moves it
        UniqueConstraint("token"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(Text)
    token: Mapped[str] = mapped_column(Text)
    # kind = liveactivity: the followed trip the Live Activity shows
    follow_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("follows.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Consecutive failed deliveries; housekeeping drops tokens that keep failing
    failure_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


def weekdays_to_mask(weekdays: list[int]) -> int:
    """ISO weekdays (1 = Monday ... 7 = Sunday) to a bitmask."""
    mask = 0
    for day in weekdays:
        if not 1 <= day <= 7:
            raise ValueError(f"invalid ISO weekday {day}")
        mask |= 1 << (day - 1)
    return mask


def mask_to_weekdays(mask: int) -> list[int]:
    return [day for day in range(1, 8) if mask & (1 << (day - 1))]
