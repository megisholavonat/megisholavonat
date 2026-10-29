"""One run of a train: its delay at each stop, for the delay summary card"""

from datetime import date

from pydantic import BaseModel

from api.schemas.alerts import DelayReason


class RunStop(BaseModel):
    """A stop of the run, with our GPS-derived delay where it was recorded"""

    stationId: str
    name: str
    # Seconds since the start of the run's service day (`serviceDate`);
    # may exceed 86400 after midnight
    scheduledArrivalS: int | None = None
    scheduledDepartureS: int | None = None
    # Minutes late when the train passed the stop (at the final stop: when it
    # arrived); null when it was not recorded
    delayMin: float | None = None
    cancelled: bool = False


class RunSummary(BaseModel):
    """
    One run of a train on one service date, from the delay history (and the
    timetable for the stops the recorder did not see)
    """

    trainNumber: str
    tripShortName: str
    routeShortName: str | None = None
    # Readable line or category name decoded from the glyph, e.g. S10, IC
    lineName: str | None = None
    # The day the stoptimes count from: the departure date from the origin
    serviceDate: date
    stops: list[RunStop]
    # Whether `stops` is the full route (false: only the recorded stops)
    complete: bool
    # Every stop of the run is cancelled
    cancelled: bool
    # The run is over: its arrival was recorded, or its schedule ended long ago
    finished: bool
    # A known delay reason from MÁV's alert on the train, if any
    reason: DelayReason | None = None
