from typing import Self

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
