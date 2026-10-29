"""Active rail disruptions from the upstream alert feed."""

import time
from typing import Any

from pydantic import RootModel
from redis.asyncio import Redis

from api.core.cache import cached_model
from api.core.graphql import query_graphql
from api.core.queries import ALERTS_QUERY
from api.core.redis import add_key
from api.schemas.alerts import AlertRoute, AlertStation, AlertTrip, RailAlert
from api.services.station_index import RAIL_FEED
from api.util.stop import station_id_from_gtfs_id

ALERTS_TTL = 2 * 60  # seconds

# Route modes counting as rail. Replacement buses are rail disruptions too.
RAIL_MODES = {"RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN", "RAIL_REPLACEMENT_BUS"}


ALERTS_KEY = "rail-alerts"


class RailAlerts(RootModel[list[RailAlert]]):
    pass


def alerts_cache_key() -> str:
    return add_key(ALERTS_KEY)


def _feed_of(gtfs_id: str | None) -> str | None:
    return gtfs_id.partition(":")[0] if gtfs_id else None


def _entity_routes(entity: dict[str, Any]) -> list[dict[str, Any]]:
    kind = entity.get("__typename")
    if kind == "Route":
        return [entity]
    if kind in ("Trip", "StopOnRoute") and entity.get("route"):
        return [entity["route"]]
    return []


def _entity_stop(entity: dict[str, Any]) -> dict[str, Any] | None:
    kind = entity.get("__typename")
    if kind == "Stop":
        return entity
    if kind == "StopOnRoute":
        stop: dict[str, Any] | None = entity.get("stop")
        return stop
    return None


def is_rail_alert(alert: dict[str, Any]) -> bool:
    """
    An alert is rail if it touches a rail route or trip, or a stop of the
    rail feed. Alerts whose routes are all non-rail are dropped; alerts with
    no resolvable entities fall back to their feed.
    """
    entities = alert.get("entities") or []
    modes = [r.get("mode") for e in entities for r in _entity_routes(e)]
    if any(mode in RAIL_MODES for mode in modes):
        return True
    if modes:
        return False

    stops = [s for e in entities if (s := _entity_stop(e)) is not None]
    if stops:
        return any(_feed_of(s.get("gtfsId")) == RAIL_FEED for s in stops)

    return bool(alert.get("feed") == RAIL_FEED)


def _station_of(stop: dict[str, Any]) -> AlertStation | None:
    parent = stop.get("parentStation") or {}
    gtfs_id: str | None = parent.get("gtfsId") or stop.get("gtfsId")
    if gtfs_id is None or _feed_of(gtfs_id) != RAIL_FEED:
        return None
    # "1:005501024_3" (platform) and "1:005501024" (station) -> "005501024"
    uic = station_id_from_gtfs_id(gtfs_id)
    return AlertStation(id=uic, name=parent.get("name") or stop.get("name") or uic)


def to_rail_alert(alert: dict[str, Any]) -> RailAlert:
    routes: dict[str, AlertRoute] = {}
    trips: dict[str, AlertTrip] = {}
    stations: dict[str, AlertStation] = {}

    for entity in alert.get("entities") or []:
        for route in _entity_routes(entity):
            if route.get("gtfsId"):
                routes.setdefault(
                    route["gtfsId"],
                    AlertRoute(
                        id=route["gtfsId"],
                        mode=route.get("mode"),
                        shortName=route.get("shortName"),
                        longName=route.get("longName"),
                    ),
                )
        if entity.get("__typename") == "Trip" and entity.get("gtfsId"):
            trips.setdefault(
                entity["gtfsId"],
                AlertTrip(
                    tripId=entity["gtfsId"],
                    tripShortName=entity.get("tripShortName"),
                ),
            )
        stop = _entity_stop(entity)
        station = _station_of(stop) if stop else None
        if station:
            stations.setdefault(station.id, station)

    return RailAlert(
        id=alert["id"],
        header=alert.get("alertHeaderText") or None,
        description=alert.get("alertDescriptionText") or "",
        url=alert.get("alertUrl") or None,
        start=alert.get("effectiveStartDate"),
        end=alert.get("effectiveEndDate"),
        affectedRoutes=list(routes.values()),
        affectedTrips=list(trips.values()),
        affectedStations=list(stations.values()),
    )


def is_active(alert: dict[str, Any], now: float) -> bool:
    start = alert.get("effectiveStartDate")
    end = alert.get("effectiveEndDate")
    return (start is None or start <= now) and (end is None or now <= end)


async def get_rail_alerts(redis: Redis) -> list[RailAlert]:
    """Active rail alerts, newest first, cached for ALERTS_TTL seconds."""

    async def build() -> RailAlerts:
        data = await query_graphql(ALERTS_QUERY, {"feeds": [RAIL_FEED]})
        now = time.time()
        alerts = [
            to_rail_alert(a)
            for a in data.get("alerts") or []
            if is_active(a, now) and is_rail_alert(a)
        ]
        alerts.sort(key=lambda a: (-(a.start or 0), a.id))
        return RailAlerts(alerts)

    cached = await cached_model(redis, ALERTS_KEY, RailAlerts, ALERTS_TTL, build)
    return cached.root
