"""Delay history read models: typical delays, rankings, platform prediction"""

from datetime import date

from pydantic import BaseModel


class HistoryWindow(BaseModel):
    """
    Service dates the statistics cover. The window ends at the latest service
    date with recorded data, so it does not drift into days without data.
    """

    start: date
    end: date
    days: int


class DelayStats(BaseModel):
    """Delay distribution of a set of stop passages (our GPS-derived delay)"""

    n: int
    medianDelayMin: float | None = None
    p80DelayMin: float | None = None
    # Share of passages at most 5 minutes late
    onTimeShare: float | None = None
    # Fewer than the minimum sample size; the numbers are not meaningful
    insufficientData: bool


class TrainStationHistory(BaseModel):
    """How late a train usually is at a station"""

    trainNumber: str
    stationId: str
    stationName: str | None = None
    window: HistoryWindow
    n: int
    medianDelayMin: float | None = None
    p80DelayMin: float | None = None
    onTimeShare: float | None = None
    insufficientData: bool
    typicalPlatform: str | None = None
    # Mon-Fri vs Sat-Sun
    weekday: DelayStats
    weekend: DelayStats


class TrainRouteStation(BaseModel):
    """One station on a train's usual route"""

    stationId: str
    stationName: str | None = None
    # Typical scheduled departure (arrival at the last stop), seconds since
    # local midnight of the service date; may exceed 86400 after midnight
    scheduledTimeS: int | None = None
    n: int
    medianDelayMin: float | None = None
    p80DelayMin: float | None = None
    onTimeShare: float | None = None
    insufficientData: bool
    typicalPlatform: str | None = None


class TrainHistory(BaseModel):
    """Per-station delay along a train's usual route"""

    trainNumber: str
    tripShortName: str | None = None
    # OTP route shortName: an MNR2007 glyph as HTML
    routeShortName: str | None = None
    # Readable line or category name decoded from the glyph, e.g. S10, IC
    lineName: str | None = None
    window: HistoryWindow
    # Distinct (service date, trip) runs observed
    runs: int
    stations: list[TrainRouteStation]
