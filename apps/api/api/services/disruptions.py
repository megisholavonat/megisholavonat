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
from dataclasses import dataclass, field
from typing import Literal

from redis.asyncio import Redis

from api.core.logging_config import get_logger
from api.schemas.alerts import (
    AlertRoute,
    AlertStation,
    AlertTrip,
    Disruption,
    DisruptionCause,
    DisruptionEffect,
    DisruptionLine,
    DisruptionSegment,
    DisruptionSeverity,
    RailAlert,
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

_TITLES: dict[DisruptionEffect, str] = {
    "no_service": "Nincs vasúti forgalom",
    "replacement_bus": "Pótlóbusz",
    "modified_service": "Módosult menetrend",
    "delays": "Késések",
    "other": "Forgalmi változás",
}


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


def find_segment(text: str, ids_by_name: dict[str, str]) -> DisruptionSegment | None:
    """The first "A és B között" / "A-B között" stretch named in the text."""
    and_match = _AND_SEGMENT.search(text)
    dash_match = _DASH_SEGMENT.search(text)
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
    first = re.split(r"(?<=[.!:])\s|\n", text.strip(), maxsplit=1)[0].rstrip(":")
    return first if len(first) <= 90 else f"{first[:89].rstrip()}…"


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
    for alert in [primary, *alerts]:
        for r in alert.affectedRoutes:
            routes.setdefault(r.id, r)
        for s in alert.affectedStations:
            stations.setdefault(s.id, s)
        for t in alert.affectedTrips:
            trips.setdefault(t.tripId, t)

    description = primary.description.strip()
    details: list[str] = []
    seen = {" ".join(description.split())}
    for alert in alerts:
        text = alert.description.strip()
        key = " ".join(text.split())
        if text and key not in seen:
            seen.add(key)
            details.append(text)

    starts = [a.start for a in alerts]
    ends = [a.end for a in alerts]
    return Disruption(
        id=primary.id,
        alertIds=sorted(a.id for a in alerts),
        effect=effect,
        cause=cause,
        severity=severity_of(effect, cause),
        scope="network" if _is_network(group) else "line",
        segment=group.segment,
        title=_title(effect, group.segment, primary.header or description),
        description=description,
        details=details,
        url=_link_of([primary, *alerts]),
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
        segment = find_segment(_text(alert), ids_by_name)
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
