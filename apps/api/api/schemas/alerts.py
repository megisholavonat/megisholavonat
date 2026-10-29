from typing import Literal, Self

from pydantic import BaseModel, model_validator

from api.util.delay_reasons import (
    DelayReasonCode,
    delay_reason_label,
    first_delay_reason_code,
)


class DelayReason(BaseModel):
    """
    A known delay reason of a train, parsed from its alert text. The label is
    Hungarian; clients can localise by code (see packages/core delayReasons).
    """

    code: DelayReasonCode
    label: str

    @classmethod
    def from_texts(cls, *texts: str | None) -> "DelayReason | None":
        """The first known reason among alert texts, or None."""
        code = first_delay_reason_code(texts)
        if code is None:
            return None
        return cls(code=code, label=delay_reason_label(code))


class AlertRoute(BaseModel):
    """Route affected by an alert"""

    id: str
    mode: str | None = None
    shortName: str | None = None
    longName: str | None = None


class AlertTrip(BaseModel):
    """Single train affected by an alert"""

    tripId: str
    tripShortName: str | None = None


class AlertStation(BaseModel):
    """Station affected by an alert"""

    id: str  # UIC station code, same as Station.id
    name: str


class RailAlert(BaseModel):
    """An active rail disruption or service notice"""

    id: str
    header: str | None = None
    # May contain HTML; clients must sanitise it before rendering
    description: str
    url: str | None = None
    # Unix seconds
    start: int | None = None
    end: int | None = None
    affectedRoutes: list[AlertRoute]
    affectedTrips: list[AlertTrip]
    affectedStations: list[AlertStation]

    # Short label when the alert is a known per-train delay reason. Derived
    # from the text on validation, so cached alerts get it too.
    reason: DelayReason | None = None

    @model_validator(mode="after")
    def _fill_reason(self) -> Self:
        if self.reason is None:
            self.reason = DelayReason.from_texts(self.description, self.header)
        return self


# What a disruption does to the service, worst first
DisruptionEffect = Literal[
    "no_service", "replacement_bus", "modified_service", "delays", "other"
]
DisruptionCause = Literal[
    "engineering", "accident", "strike", "weather", "technical", "other"
]
DisruptionSeverity = Literal["high", "medium", "low"]
# "line": one line or a stretch of it; "network": no particular line
DisruptionScope = Literal["line", "network"]


class DisruptionSegment(BaseModel):
    """The stretch between two stations, as MÁV names it in the text"""

    fromName: str
    toName: str
    # UIC station codes when the names resolve to a rail station
    fromId: str | None = None
    toId: str | None = None


class DisruptionLine(BaseModel):
    """A line glyph to show, deduplicated across the affected routes"""

    # MNR2007 glyph HTML, like Route.shortName
    shortName: str
    # Line name ("S50", "H8") when the route has one
    name: str | None = None
    mode: str | None = None


class Disruption(BaseModel):
    """
    A line or network disruption: the rail alerts about one event, merged.
    Per-train notices (delay reasons, coach changes) are not disruptions;
    they stay on the train.
    """

    # Id of the main alert of the group
    id: str
    alertIds: list[str]
    effect: DisruptionEffect
    cause: DisruptionCause
    severity: DisruptionSeverity
    scope: DisruptionScope
    segment: DisruptionSegment | None = None
    # Plain Hungarian title; clients can build a localised one from the
    # effect and the segment
    title: str
    # Full text of the main alert; the other distinct texts in `details`
    description: str
    details: list[str]
    # MÁV's link, or the MÁVINFORM page when the alerts have none
    url: str
    # Unix seconds; None is open-ended
    start: int | None = None
    end: int | None = None
    lines: list[DisruptionLine]
    routes: list[AlertRoute]
    stations: list[AlertStation]
    trips: list[AlertTrip]
