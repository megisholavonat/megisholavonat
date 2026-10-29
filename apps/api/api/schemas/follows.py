import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

from api.models.devices import DEFAULT_DELAY_THRESHOLD_MIN

# UIC station code, e.g. "005501024" (same as Station.id)
StationId = Annotated[str, Field(pattern=r"^\d{1,16}$", examples=["005501024"])]
# OTP trip or stop gtfsId, e.g. "1:32737794" or "1:005501024_14"
GtfsId = Annotated[str, Field(min_length=1, max_length=128)]
# Train number with its name, e.g. "559 AGRIA InterRégió" or just "559"
TripShortName = Annotated[str, Field(min_length=1, max_length=128)]
Label = Annotated[str, Field(min_length=1, max_length=64)]
DelayThreshold = Annotated[int, Field(ge=0, le=240)]
# ISO weekdays, 1 = Monday ... 7 = Sunday
Weekdays = Annotated[list[Annotated[int, Field(ge=1, le=7)]], Field(min_length=1)]


def _normalize_weekdays(v: list[int] | None) -> list[int] | None:
    return None if v is None else sorted(set(v))


def _strip_name(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("must not be blank")
    return v


ShortText = Annotated[str, Field(min_length=1, max_length=128)]
# Seconds since midnight of the service date (above 86400 past midnight)
ServiceSeconds = Annotated[int, Field(ge=0, le=2 * 86400)]


class LiveActivitySetup(BaseModel):
    """
    iOS: the follow's Live Activity, started by the API with a push some
    minutes before departure (iOS 17.2+). What the activity shows until the
    train is live, as the app saw the train when following it.
    """

    # Line badge, e.g. "S70" or "IC"
    badge: Annotated[str, Field(min_length=1, max_length=16)]
    # e.g. "2423 → Vác"
    title: ShortText
    fromName: ShortText
    toName: ShortText
    # Scheduled departure from the boarding station and arrival at the
    # alighting station; commutes repeat them on their weekdays
    departureS: ServiceSeconds
    arrivalS: ServiceSeconds | None = None
    # Platform at the boarding station (a commute's may change from day to day)
    platform: Annotated[str, Field(min_length=1, max_length=16)] | None = None


class AlertPrefs(BaseModel):
    """Alert preferences of a follow"""

    alertsEnabled: bool = True
    # Alert when the train is more than this many minutes late
    delayThresholdMin: DelayThreshold = DEFAULT_DELAY_THRESHOLD_MIN
    notifyPlatformChange: bool = True
    # iOS: start the follow's Live Activity by push; null or absent: don't
    liveActivity: LiveActivitySetup | None = None


class TripFollowCreate(AlertPrefs):
    """Follow one trip on one service date"""

    kind: Literal["trip"]
    tripId: GtfsId
    serviceDate: date
    tripShortName: TripShortName
    # Platform-level stops where the device boards and leaves
    fromStopId: GtfsId | None = None
    toStopId: GtfsId | None = None

    _strip = field_validator("tripShortName")(_strip_name)


class CommuteFollowCreate(AlertPrefs):
    """
    Follow a train taken regularly. Train numbers are not unique within a day,
    so the boarding station is required to pick the right trip.
    """

    kind: Literal["commute"]
    tripShortName: TripShortName
    weekdays: Weekdays
    fromStationId: StationId
    toStationId: StationId | None = None
    label: Label | None = None

    _strip = field_validator("tripShortName")(_strip_name)
    _weekdays = field_validator("weekdays")(_normalize_weekdays)


FollowCreate = Annotated[
    TripFollowCreate | CommuteFollowCreate, Field(discriminator="kind")
]


class FollowUpdate(BaseModel):
    """
    Partial update. Weekdays, stations and label only apply to commutes;
    toStationId, label and liveActivity can be cleared with null.
    """

    alertsEnabled: bool | None = None
    delayThresholdMin: DelayThreshold | None = None
    notifyPlatformChange: bool | None = None
    weekdays: Weekdays | None = None
    fromStationId: StationId | None = None
    toStationId: StationId | None = None
    label: Label | None = None
    liveActivity: LiveActivitySetup | None = None

    _weekdays = field_validator("weekdays")(_normalize_weekdays)


class FollowBase(BaseModel):
    id: uuid.UUID
    tripShortName: str
    alertsEnabled: bool
    delayThresholdMin: int
    notifyPlatformChange: bool
    liveActivity: LiveActivitySetup | None = None
    createdAt: datetime
    updatedAt: datetime


class TripFollow(FollowBase):
    kind: Literal["trip"]
    tripId: str
    serviceDate: date
    fromStopId: str | None
    toStopId: str | None


class CommuteFollow(FollowBase):
    kind: Literal["commute"]
    weekdays: list[int]
    fromStationId: str
    toStationId: str | None
    label: str | None


Follow = Annotated[TripFollow | CommuteFollow, Field(discriminator="kind")]
