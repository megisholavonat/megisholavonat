"""
Line and network disruptions, picked out of the rail alert feed.

Most rail alerts are about one train: a delay reason ("Pálya állapota miatti
késés"), a coach change, an expected delay. Those stay on the train. What is
left are notices about a line or the network (track closures, replacement
buses, engineering works, timetable changes, strikes, weather); the same
event often comes as a station-level MÁVINFORM notice plus one alert per
direction listing its trains, so alerts about the same stretch are merged.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal, cast

from redis.asyncio import Redis

from api.core.logging_config import get_logger
from api.schemas.alerts import (
    AlertRoute,
    AlertStation,
    AlertTrip,
    DelayReason,
    Disruption,
    DisruptionCause,
    DisruptionEffect,
    DisruptionLine,
    DisruptionSegment,
    DisruptionSeverity,
    RailAlert,
    TrainDisruption,
)
from api.services.alerts_service import get_rail_alerts
from api.services.station_index import load_station_index
from api.util.search import normalize_search_text

logger = get_logger(__name__)

MAVINFORM_URL = "https://www.mavcsoport.hu/mavinform"

AlertKind = Literal["delay_reason", "train_notice", "disruption"]

# Checked in order; the first match wins. Replacement buses come before the
# on-board notices so "14-es kocsiállás" in a bus stop list does not count
# as a coach notice.
_EFFECTS: list[tuple[DisruptionEffect, re.Pattern[str]]] = [
    (
        "replacement_bus",
        re.compile(r"pótló ?bus|vonatpótló|autóbusszal utazhat", re.I),
    ),
    (
        "no_service",
        re.compile(
            r"nem lehetséges|nem közlekedik|nem közlekednek|szünetel|"
            r"nem áll(?:nak)? meg|nem érint|elmarad|kimarad|lezárás",
            re.I,
        ),
    ),
    (
        "modified_service",
        re.compile(
            r"menetrend|módosul|módosított|eltérő|változ|korlátoz|terel|"
            r"rövidített|mentesítő|vágányzár",
            re.I,
        ),
    ),
    (
        "delays",
        re.compile(r"késés(?:ekre|re)? (?:kell számítani|várható)|késhet", re.I),
    ),
]

_CAUSES: list[tuple[DisruptionCause, re.Pattern[str]]] = [
    ("strike", re.compile(r"sztrájk|munkabeszüntetés", re.I)),
    (
        "weather",
        re.compile(
            r"időjárás|vihar|havazás|hóakadály|ónos|árvíz|villám|hőség|"
            r"(?:ki)?dőlt fa|erős szél",
            re.I,
        ),
    ),
    (
        "accident",
        re.compile(r"baleset|elütött|gázolás|ütközés|tűz|kisikl", re.I),
    ),
    (
        "engineering",
        re.compile(
            r"karbantart|felújítás|építés|munkálat|vágányzár|korszerűsítés|"
            r"beruházás",
            re.I,
        ),
    ),
    (
        "technical",
        re.compile(
            r"műszaki hiba|meghibásod|biztosítóberendezés|felsővezeték|"
            r"áramszünet|áramellátás",
            re.I,
        ),
    ),
]

# About the train itself: its coaches, seats, services, or its own delay
_TRAIN_NOTICE = re.compile(
    r"\bkocsi(?!állás)|szerelvény|ülőhely|étkező|büfé|kerékpár|kerekesszék|"
    r"lezárva közlekedik|^\s*várhatóan .*késéssel",
    re.I,
)

_NETWORK = re.compile(r"országos|teljes hálózat|valamennyi vonal", re.I)

_UPPER = "A-ZÁÉÍÓÖŐÚÜŰ"
# "Örs vezér tere és Cinkota között", "Mándok és Tornyospálca állomások
# között". A name starts with a capital and has at most four words.
_AND_SEGMENT = re.compile(
    rf"(?P<a>[{_UPPER}][\w.]*(?:[- ][\w.]+){{0,3}}?) és "
    rf"(?P<b>[{_UPPER}][\w.]*(?:[- ][\w.]+){{0,3}}?) "
    r"(?:(?:vasút)?állomások |megállóhelyek )?közötti?\b"
)
# "Mándok-Tornyospálca között": names may hold hyphens themselves
# ("Budapest-Nyugati"), so the split is chosen later
_DASH_SEGMENT = re.compile(
    rf"(?P<pair>[{_UPPER}][\w.]*(?:[-\u2013][\w.]+)+) "
    r"(?:(?:vasút)?állomások |megállóhelyek )?közötti?\b"
)

_LEADING_NAME = re.compile(rf"\s*([{_UPPER}][\w-]*)")

# A capitalised word with a case ending: "Tapolcáról", "Balatonfüredre"
_INFLECTED_NAME = re.compile(rf"\b[{_UPPER}][\w-]*")
_FROM_SUFFIX = re.compile(r"(?:ról|ről|ból|ből|tól|től)$")
_TO_SUFFIX = re.compile(r"(?:ra|re|ba|be|ig)$")

# A train number in brackets: "Balatonfüredre (9759)"
_TRAIN_NUMBER = re.compile(r"\((\d{3,6})\)")

_URL = re.compile(r"(?:https?://|www\.)[^\s<>\"]+", re.I)

_LINE_NAME = re.compile(r"[A-Z]{1,3}\d{1,3}[A-Z]?")

_SEVERITY_RANK: dict[DisruptionSeverity, int] = {"high": 0, "medium": 1, "low": 2}
_EFFECT_RANK: dict[DisruptionEffect, int] = {
    "no_service": 0,
    "replacement_bus": 1,
    "modified_service": 2,
    "delays": 3,
    "other": 4,
}

TITLE_MAX = 90

_TITLES: dict[DisruptionEffect, str] = {
    "no_service": "Nincs vasúti forgalom",
    "replacement_bus": "Pótlóbusz",
    "modified_service": "Módosult menetrend",
    "delays": "Késések",
    "other": "Forgalmi változás",
}


def _train_number(trip_short_name: str | None) -> str:
    """ "9759 személyvonat" -> "9759"."""
    return (trip_short_name or "").split(" ", 1)[0]


def _text(alert: RailAlert) -> str:
    return " ".join(t for t in (alert.header, alert.description) if t)


def alert_kind(alert: RailAlert) -> AlertKind:
    """Whether an alert is about one train or about the service."""
    if alert.reason is not None:
        return "delay_reason"
    text = _text(alert)
    if _EFFECTS[0][1].search(text):
        return "disruption"
    if _TRAIN_NOTICE.search(text):
        return "train_notice"
    return "disruption"


def alert_effect(text: str) -> DisruptionEffect:
    for effect, pattern in _EFFECTS:
        if pattern.search(text):
            return effect
    return "other"


def alert_cause(text: str) -> DisruptionCause:
    for cause, pattern in _CAUSES:
        if pattern.search(text):
            return cause
    return "other"


def severity_of(effect: DisruptionEffect, cause: DisruptionCause) -> DisruptionSeverity:
    """High: trains do not run. Medium: they run differently or late."""
    if effect in ("no_service", "replacement_bus") or cause == "strike":
        return "high"
    if effect in ("modified_service", "delays") or cause in ("accident", "weather"):
        return "medium"
    return "low"


def _resolve(name: str, ids_by_name: dict[str, str]) -> str | None:
    return ids_by_name.get(normalize_search_text(name))


def _station_in(
    word: str, ids_by_name: dict[str, str], names: dict[str, str]
) -> tuple[str, str | None] | None:
    """
    The station an inflected word names ("Tapolcáról" -> Tapolca), as
    (display name, id): the longest known name the word starts with, followed
    by a case ending of at most four letters. The display name comes from
    `names` when known, else from the word itself; a final a/e lengthens
    before a suffix in Hungarian ("Tapolcá-ra"), so that is undone.
    """
    key = normalize_search_text(word)
    best: str | None = None
    for name in (*names, *ids_by_name):
        if (
            key.startswith(name)
            and 0 < len(key) - len(name) <= 4
            and (best is None or len(name) > len(best))
        ):
            best = name
    if best is None:
        return None
    display = names.get(best)
    if display is None:
        display = word[: len(best)]
        if best[-1] in "ae" and display[-1] in "áé":
            display = display[:-1] + best[-1]
    return display, ids_by_name.get(best)


def _from_to_segment(
    text: str, ids_by_name: dict[str, str], names: dict[str, str]
) -> DisruptionSegment | None:
    """
    "a Tapolcáról 4:41-kor Balatonfüredre induló vonat": a train's stretch
    from an elative/ablative place name to the next allative/terminative one
    in the same sentence.
    """
    for sentence in re.split(r"(?<=[.!?])\s+|\n", text):
        words = list(_INFLECTED_NAME.finditer(sentence))
        for i, start in enumerate(words):
            if not _FROM_SUFFIX.search(start[0]):
                continue
            origin = _station_in(start[0], ids_by_name, names)
            if origin is None:
                continue
            for end in words[i + 1 : i + 4]:
                if not _TO_SUFFIX.search(end[0]):
                    continue
                destination = _station_in(end[0], ids_by_name, names)
                if destination is not None and destination[0] != origin[0]:
                    return DisruptionSegment(
                        fromName=origin[0],
                        toName=destination[0],
                        fromId=origin[1],
                        toId=destination[1],
                    )
    return None


def find_segment(
    text: str,
    ids_by_name: dict[str, str],
    stations: list[AlertStation] | None = None,
) -> DisruptionSegment | None:
    """
    The first "A és B között" / "A-B között" stretch named in the text, or
    else a train's "A-ról B-re" run between two known stations.
    """
    and_match = _AND_SEGMENT.search(text)
    dash_match = _DASH_SEGMENT.search(text)
    if not and_match and not dash_match:
        names = {normalize_search_text(s.name): s.name for s in stations or []}
        return _from_to_segment(text, ids_by_name, names)
    if and_match and (not dash_match or and_match.start() <= dash_match.start()):
        a, b = and_match["a"], and_match["b"]
        return DisruptionSegment(
            fromName=a,
            toName=b,
            fromId=_resolve(a, ids_by_name),
            toId=_resolve(b, ids_by_name),
        )
    if not dash_match:
        return None
    pair = dash_match["pair"]
    splits = [m.start() for m in re.finditer("[-\u2013]", pair)]
    # An en dash separates; otherwise prefer a split where both names are
    # known stations, then the first hyphen
    dashes = [i for i in splits if pair[i] == "\u2013"]
    candidates = dashes or splits
    best = candidates[0]
    for i in candidates:
        if _resolve(pair[:i], ids_by_name) and _resolve(pair[i + 1 :], ids_by_name):
            best = i
            break
    a, b = pair[:best], pair[best + 1 :]
    return DisruptionSegment(
        fromName=a,
        toName=b,
        fromId=_resolve(a, ids_by_name),
        toId=_resolve(b, ids_by_name),
    )


def _segment_key(segment: DisruptionSegment) -> frozenset[str]:
    return frozenset(
        {normalize_search_text(segment.fromName), normalize_search_text(segment.toName)}
    )


def _link_of(alerts: list[RailAlert]) -> str:
    for alert in alerts:
        if alert.url:
            return alert.url
    for alert in alerts:
        match = _URL.search(_text(alert))
        if match:
            url = match[0].rstrip(".,;:)")
            return url if "://" in url else f"https://{url}"
    return MAVINFORM_URL


def _title(
    effect: DisruptionEffect, segment: DisruptionSegment | None, text: str
) -> str:
    if segment:
        return f"{_TITLES[effect]} {segment.fromName} és {segment.toName} között"
    # A short first sentence is a title; a long one is never cut mid-way,
    # the effect stands alone instead
    first = re.split(r"(?<=[.!:])\s|\n", text.strip(), maxsplit=1)[0].rstrip(":")
    return first if len(first) <= TITLE_MAX else _TITLES[effect]


def lines_of(routes: list[AlertRoute]) -> list[DisruptionLine]:
    """One entry per glyph and line name, named lines first."""
    seen: dict[tuple[str, str | None], DisruptionLine] = {}
    for route in routes:
        if not route.shortName:
            continue
        long_name = (route.longName or "").strip()
        name = long_name if _LINE_NAME.fullmatch(long_name) else None
        seen.setdefault(
            (route.shortName, name),
            DisruptionLine(shortName=route.shortName, name=name, mode=route.mode),
        )
    return sorted(seen.values(), key=lambda line: (line.name is None, line.name or ""))


@dataclass
class _Group:
    alerts: list[RailAlert] = field(default_factory=list)
    segment: DisruptionSegment | None = None
    # Notices of single trains the event names: they add the trains, their
    # lines and details, but not their (often whole-day) validity
    trains: list[RailAlert] = field(default_factory=list)


def _primary(alerts: list[RailAlert]) -> RailAlert:
    """The notice of the whole event: station or route level, longest text."""
    return min(
        alerts,
        key=lambda a: (
            0 if a.affectedStations or not a.affectedTrips else 1,
            -len(a.description),
            a.id,
        ),
    )


def _host_of(group: _Group, hosts: list[_Group]) -> _Group | None:
    """
    The station notice whose stations the group's text starts from. Hungarian
    adds case endings ("Veresegyháztól"), so a short suffix is allowed.
    """
    match = _LEADING_NAME.match(_text(group.alerts[0]))
    if not match:
        return None
    word = normalize_search_text(match[1])
    for host in hosts:
        names = {
            normalize_search_text(s.name)
            for a in host.alerts
            for s in a.affectedStations
        }
        if any(word.startswith(n) and len(word) - len(n) <= 4 for n in names):
            return host
    return None


def _is_line_level(group: _Group) -> bool:
    trips = {t.tripId for a in group.alerts for t in a.affectedTrips}
    return (
        any(
            a.affectedStations or (a.affectedRoutes and not a.affectedTrips)
            for a in group.alerts
        )
        or len(trips) >= 2
    )


def _is_network(group: _Group) -> bool:
    return any(
        not (a.affectedStations or a.affectedRoutes or a.affectedTrips)
        or _NETWORK.search(_text(a))
        for a in group.alerts
    )


def _merge(group: _Group) -> Disruption:
    alerts = group.alerts
    primary = _primary(alerts)
    texts = [_text(a) for a in alerts]
    effect = min((alert_effect(t) for t in texts), key=_EFFECT_RANK.__getitem__)
    causes = [c for t in texts if (c := alert_cause(t)) != "other"]
    cause: DisruptionCause = causes[0] if causes else "other"

    routes: dict[str, AlertRoute] = {}
    stations: dict[str, AlertStation] = {}
    trips: dict[str, AlertTrip] = {}
    everything = [primary, *alerts, *group.trains]
    for alert in everything:
        for r in alert.affectedRoutes:
            routes.setdefault(r.id, r)
        for s in alert.affectedStations:
            stations.setdefault(s.id, s)
        for t in alert.affectedTrips:
            trips.setdefault(t.tripId, t)

    description = primary.description.strip()
    details: list[str] = []
    seen = {" ".join(description.split())}
    for alert in everything:
        text = alert.description.strip()
        key = " ".join(text.split())
        if text and key not in seen:
            seen.add(key)
            details.append(text)

    starts = [a.start for a in alerts]
    ends = [a.end for a in alerts]
    return Disruption(
        id=primary.id,
        alertIds=sorted({a.id for a in everything}),
        effect=effect,
        cause=cause,
        severity=severity_of(effect, cause),
        scope="network" if _is_network(group) else "line",
        segment=group.segment,
        title=_title(effect, group.segment, primary.header or description),
        description=description,
        details=details,
        url=_link_of(everything),
        start=None if None in starts else min(s for s in starts if s is not None),
        end=None if None in ends else max(e for e in ends if e is not None),
        lines=lines_of(list(routes.values())),
        routes=list(routes.values()),
        stations=list(stations.values()),
        trips=list(trips.values()),
    )


def group_disruptions(
    alerts: list[RailAlert], ids_by_name: dict[str, str] | None = None
) -> list[Disruption]:
    """
    Merges the service alerts into disruptions, worst and newest first.
    Alerts naming the same stretch are one event; others merge only with
    the same text. Groups about a single train are dropped.
    """
    ids_by_name = dict(ids_by_name or {})
    for alert in alerts:
        for station in alert.affectedStations:
            ids_by_name.setdefault(normalize_search_text(station.name), station.id)

    groups: dict[object, _Group] = {}
    for alert in alerts:
        if alert_kind(alert) != "disruption":
            continue
        segment = find_segment(_text(alert), ids_by_name, alert.affectedStations)
        key: object = (
            _segment_key(segment)
            if segment
            else " ".join(normalize_search_text(_text(alert)).split())
        )
        group = groups.setdefault(key, _Group())
        group.alerts.append(alert)
        if group.segment is None:
            group.segment = segment

    # Train-level follow-ups of a station notice ("Veresegyháztól
    # pótlóbusszal utazhatnak" under the Veresegyház line notice) join it
    hosts = [g for g in groups.values() if any(a.affectedStations for a in g.alerts)]
    for key, group in list(groups.items()):
        if group in hosts or group.segment:
            continue
        host = _host_of(group, hosts)
        if host:
            host.alerts.extend(group.alerts)
            del groups[key]

    # A train's own notice joins the event that names it ("Tapolcáról
    # Balatonfüredre (9759) ... pótlóbusz" and 9759's "Pótlóbusz közlekedik"),
    # so the event lists the train
    named = {
        number: group
        for group in groups.values()
        if _is_line_level(group) or _is_network(group)
        for alert in group.alerts
        for number in _TRAIN_NUMBER.findall(_text(alert))
    }
    for key, group in list(groups.items()):
        if _is_line_level(group) or _is_network(group):
            continue
        numbers = {
            _train_number(t.tripShortName)
            for a in group.alerts
            for t in a.affectedTrips
        }
        event = next((named[n] for n in numbers if n in named), None)
        if event is not None and event is not group:
            event.trains.extend(group.alerts)
            del groups[key]

    disruptions = [
        _merge(g) for g in groups.values() if _is_line_level(g) or _is_network(g)
    ]
    disruptions.sort(key=lambda d: (_SEVERITY_RANK[d.severity], -(d.start or 0), d.id))
    return disruptions


async def _station_ids_by_name(redis: Redis) -> dict[str, str]:
    """Rail station ids by normalised name; empty if the index is down."""
    try:
        stations = await load_station_index(redis)
    except Exception:
        logger.warning("Station index unavailable for disruptions", exc_info=True)
        return {}
    ids: dict[str, str] = {}
    for station in stations:
        if not station.in_hungary:
            continue
        ids.setdefault(station.normalized, station.id)
        # HÉV stops are "Cinkota H"; notices write "Cinkota"
        if station.normalized.endswith(" h"):
            ids.setdefault(station.normalized[:-2], station.id)
    return ids


async def get_disruptions(redis: Redis) -> list[Disruption]:
    """Active line and network disruptions."""
    alerts = await get_rail_alerts(redis)
    return group_disruptions(alerts, await _station_ids_by_name(redis))


# --- trains on boards ---

# Worst first
_TRAIN_DISRUPTION_RANK: dict[TrainDisruption, int] = {
    "no_service": 0,
    "replacement_bus": 1,
}


def train_disruption(text: str) -> TrainDisruption | None:
    """
    Whether a notice says a train does not run or is replaced by a bus (on
    all or part of its run). Delay reasons and notices about its coaches or
    services ("Kerékpárszállítás nem lehetséges") do not count.
    """
    if DelayReason.from_texts(text) is not None:
        return None
    if _EFFECTS[0][1].search(text):
        return "replacement_bus"
    if _TRAIN_NOTICE.search(text):
        return None
    return "no_service" if alert_effect(text) == "no_service" else None


def worst_train_disruption(
    effects: Iterable[TrainDisruption | None],
) -> TrainDisruption | None:
    found = [e for e in effects if e is not None]
    if not found:
        return None
    worst: TrainDisruption = min(found, key=_TRAIN_DISRUPTION_RANK.__getitem__)
    return worst


@dataclass
class _Window:
    effect: TrainDisruption
    start: int | None
    end: int | None

    def covers(self, moment: int) -> bool:
        return (self.start is None or self.start <= moment) and (
            self.end is None or moment <= self.end
        )


@dataclass
class TrainDisruptions:
    """The trains line disruptions name, by trip id and by train number."""

    by_trip: dict[str, list[_Window]] = field(default_factory=dict)
    by_number: dict[str, list[_Window]] = field(default_factory=dict)

    def of(self, trip_id: str, number: str, moment: int) -> TrainDisruption | None:
        windows = [*self.by_trip.get(trip_id, []), *self.by_number.get(number, [])]
        return worst_train_disruption(w.effect for w in windows if w.covers(moment))


def trains_of(disruptions: list[Disruption]) -> TrainDisruptions:
    """
    The trains each replacement-bus or no-service disruption names: its trips,
    and train numbers in brackets in its text ("Balatonfüredre (9759)").
    Trip ids repeat daily, so each only counts within the event's validity.
    """
    index = TrainDisruptions()
    for d in disruptions:
        if d.effect not in _TRAIN_DISRUPTION_RANK:
            continue
        window = _Window(cast(TrainDisruption, d.effect), d.start, d.end)
        for trip in d.trips:
            index.by_trip.setdefault(trip.tripId, []).append(window)
        for text in (d.description, *d.details):
            for number in _TRAIN_NUMBER.findall(text):
                index.by_number.setdefault(number, []).append(window)
    return index


async def get_train_disruptions(redis: Redis) -> TrainDisruptions:
    """Best effort: an empty index when the alerts are unavailable."""
    try:
        return trains_of(await get_disruptions(redis))
    except Exception:
        logger.warning("Disruptions unavailable for boards", exc_info=True)
        return TrainDisruptions()
