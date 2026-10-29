"""Delay history read models: typical delays, rankings, platform prediction"""

from datetime import date
from typing import Literal

from pydantic import BaseModel

from api.util.stop import StationType


class HistoryWindow(BaseModel):
    """Service dates the statistics cover: the last `days` up to today"""

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
    # Working days vs Sat, Sun and Hungarian public holidays (and bridge days)
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


RankingKind = Literal["stations", "lines", "trains"]
RankingOrder = Literal["best", "worst"]


class RankingEntry(BaseModel):
    rank: int
    # stationId, line name (S10, Z30, IC, ...) or train number, by kind
    id: str
    name: str | None = None
    # Most common OTP route shortName (MNR2007 glyph HTML); not for stations
    routeShortName: str | None = None
    n: int
    onTimeShare: float
    medianDelayMin: float


class Rankings(BaseModel):
    kind: RankingKind
    order: RankingOrder
    minSamples: int
    window: HistoryWindow
    entries: list[RankingEntry]


class HourPunctuality(BaseModel):
    # Local hour of the scheduled departure, 0-23
    hour: int
    n: int
    onTimeShare: float | None = None
    medianDelayMin: float | None = None


class TimeOfDayPunctuality(BaseModel):
    stationId: str | None = None
    window: HistoryWindow
    hours: list[HourPunctuality]


class PlatformPrediction(BaseModel):
    trainNumber: str
    tripShortName: str | None = None
    routeShortName: str | None = None
    lineName: str | None = None
    # Most common platform; ties go to the most recently used one
    platform: str
    # Share of the train's passages here that used this platform
    confidence: float
    n: int


class TypicalDelay(BaseModel):
    """A train's usual delay at one station, for "usually late" before departure"""

    trainNumber: str
    n: int
    medianDelayMin: float | None = None
    insufficientData: bool


class StationPlatforms(BaseModel):
    stationId: str
    stationName: str | None = None
    window: HistoryWindow
    predictions: list[PlatformPrediction]
    # Trains whose median delay here is at least a minute
    typicalDelays: list[TypicalDelay] = []


class DirectoryStation(BaseModel):
    """A domestic station with regular service"""

    id: str
    name: str
    type: StationType = "rail"


class DirectoryTrain(BaseModel):
    """A train number that runs regularly"""

    trainNumber: str
    # The most common full name, e.g. "10 TRANSCARPATHIA"
    tripShortName: str
    routeShortName: str | None = None


class Directory(BaseModel):
    """
    Stations and train numbers with regular service in the window: the pages
    the website lists for search engines
    """

    window: HistoryWindow
    stations: list[DirectoryStation]
    trains: list[DirectoryTrain]
