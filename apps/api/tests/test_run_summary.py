import json
from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any

import fakeredis
import httpx
import pytest
import respx
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.redis import add_key
from api.models.history import Stop, StopDelayObservation
from api.services import run_summary
from api.services.history import ensure_partition
from api.util.time import service_day_start
from tests.upstream import graphql_route

DAY = date(2026, 10, 27)
# Szolnok -> Cegléd -> Budapest-Nyugati, 7:15, 7:40, 8:30
STATIONS = [
    ("005513748", "Szolnok", 7 * 3600 + 15 * 60),
    ("005513102", "Cegléd", 7 * 3600 + 40 * 60),
    ("005510033", "Budapest-Nyugati", 8 * 3600 + 30 * 60),
]
TRIP = "1:2614"


@pytest.fixture(autouse=True)
def _today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(run_summary, "today", lambda: DAY + timedelta(days=1))


def _obs(
    seq: int,
    delay_s: int,
    *,
    day: date = DAY,
    seen_day: date | None = None,
    trip: str = TRIP,
    train: str = "2614 személyvonat",
    stations: list[tuple[str, str, int]] = STATIONS,
) -> dict[str, Any]:
    station, _, scheduled = stations[seq]
    # Seen when it passed, on the day the stoptimes really count from
    seen = service_day_start(seen_day or day) + timedelta(seconds=scheduled + delay_s)
    return {
        "service_date": day,
        "trip_gtfs_id": trip,
        "stop_sequence": seq,
        "trip_short_name": train,
        "route_short_name": '<span class="MNR2007">&#360;</span>',
        "stop_id": f"1:{station}_1",
        "station_id": station,
        "scheduled_arrival_s": scheduled,
        "scheduled_departure_s": scheduled,
        "delay_s": delay_s,
        "platform": "1",
        "observed_at": seen,
    }


async def _seed(
    session: AsyncSession,
    rows: list[dict[str, Any]],
    stations: list[tuple[str, str, int]] = STATIONS,
) -> None:
    names = {s: n for s, n, _ in stations}
    stops = {
        r["stop_id"]: {
            "gtfs_id": r["stop_id"],
            "station_id": r["station_id"],
            "name": names[r["station_id"]],
            "lat": 47.0,
            "lon": 19.0,
        }
        for r in rows
    }
    await session.execute(
        insert(Stop).values(list(stops.values())).on_conflict_do_nothing()
    )
    for d in {r["service_date"] for r in rows}:
        await ensure_partition(session, d)
    await session.execute(insert(StopDelayObservation).values(rows))
    await session.flush()


def _stoptimes(
    stations: list[tuple[str, str, int]] = STATIONS, cancelled: bool = False
) -> list[dict[str, Any]]:
    return [
        {
            "scheduledArrival": t,
            "scheduledDeparture": t,
            "realtimeState": "CANCELED" if cancelled else "UPDATED",
            "stop": {
                "gtfsId": f"1:{s}_1",
                "stationUicPricingCode": s,
                "name": n,
            },
        }
        for s, n, t in stations
    ]


def _timetable(
    otp: respx.MockRouter,
    alerts: list[str] | None = None,
    fail: bool = False,
) -> respx.Route:
    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert "query RunTrip" in body["query"]
        if fail:
            return httpx.Response(502)
        return httpx.Response(
            200,
            json={
                "data": {
                    "trip": {
                        "gtfsId": body["variables"]["id"],
                        "tripShortName": "2614 személyvonat",
                        "route": {"shortName": "x"},
                        "stoptimesForDate": _stoptimes(),
                        "alerts": [{"alertDescriptionText": a} for a in (alerts or [])],
                    }
                }
            },
        )

    return graphql_route(otp).mock(side_effect=respond)


async def test_finished_run_with_its_timetable_and_reason(
    client: httpx.AsyncClient, db_session: AsyncSession, otp: respx.MockRouter
) -> None:
    await _seed(db_session, [_obs(0, 60), _obs(2, 23 * 60)])
    route = _timetable(otp, alerts=["Pálya állapota miatti késés"])

    r = await client.get("/v1/history/runs/2614/2026-10-27")

    assert r.status_code == 200
    body = r.json()
    assert route.calls[0].request.content.find(b'"20261027"') > 0
    assert body["trainNumber"] == "2614"
    assert body["serviceDate"] == "2026-10-27"
    assert body["complete"] is True
    assert body["finished"] is True
    assert body["cancelled"] is False
    assert body["reason"] == {"code": "track", "label": "Pálya állapota"}
    assert [s["name"] for s in body["stops"]] == [
        "Szolnok",
        "Cegléd",
        "Budapest-Nyugati",
    ]
    assert [s["delayMin"] for s in body["stops"]] == [1.0, None, 23.0]
    assert body["stops"][2]["scheduledArrivalS"] == 8 * 3600 + 30 * 60


async def test_recorded_stops_only_without_the_timetable(
    client: httpx.AsyncClient, db_session: AsyncSession, otp: respx.MockRouter
) -> None:
    await _seed(db_session, [_obs(0, 60), _obs(1, 300)])
    _timetable(otp, fail=True)

    body = (await client.get("/v1/history/runs/2614/2026-10-27")).json()

    assert body["complete"] is False
    assert [s["name"] for s in body["stops"]] == ["Szolnok", "Cegléd"]
    assert body["reason"] is None
    # The final arrival was not recorded; the schedule is long over
    assert body["finished"] is True


async def test_cached_after_the_first_request(
    client: httpx.AsyncClient, db_session: AsyncSession, otp: respx.MockRouter
) -> None:
    await _seed(db_session, [_obs(0, 60), _obs(2, 120)])
    route = _timetable(otp)

    await client.get("/v1/history/runs/2614/2026-10-27")
    await client.get("/v1/history/runs/2614/2026-10-27")

    assert route.call_count == 1


async def test_hev_after_midnight_counts_from_the_next_day(
    client: httpx.AsyncClient, db_session: AsyncSession, otp: respx.MockRouter
) -> None:
    # OTP dates a 0:13 HÉV by the day before, with stoptimes under 86400
    hev = [("003609001", "Batthyány tér H", 780), ("003609142", "Szentendre H", 3120)]
    rows = [
        _obs(
            i,
            60,
            day=DAY,
            seen_day=DAY + timedelta(days=1),
            trip="1:h",
            train="H8000 HÉV",
            stations=hev,
        )
        for i in range(2)
    ]
    await _seed(db_session, rows, hev)
    _timetable(otp, fail=True)

    assert (await client.get("/v1/history/runs/H8000/2026-10-27")).status_code == 404
    body = (await client.get("/v1/history/runs/H8000/2026-10-28")).json()
    assert body["serviceDate"] == "2026-10-28"
    assert body["stops"][0]["scheduledDepartureS"] == 780


async def test_train_10_dated_the_next_day_counts_from_its_departure(
    client: httpx.AsyncClient, db_session: AsyncSession, otp: respx.MockRouter
) -> None:
    # The 22:40 departure of the 26th, carrying the 27th as its date
    ten = [("005510017", "Budapest-Keleti", 81600), ("005514175", "Záhony", 99420)]
    rows = [
        _obs(
            i,
            120,
            day=DAY,
            seen_day=DAY - timedelta(days=1),
            trip="1:ten",
            train="10 TRANSCARPATHIA",
            stations=ten,
        )
        for i in range(2)
    ]
    await _seed(db_session, rows, ten)
    _timetable(otp, fail=True)

    assert (await client.get("/v1/history/runs/10/2026-10-27")).status_code == 404
    body = (await client.get("/v1/history/runs/10/2026-10-26")).json()
    assert body["serviceDate"] == "2026-10-26"
    assert body["stops"][-1]["delayMin"] == 2.0


async def test_boarding_after_midnight_finds_the_previous_days_run(
    client: httpx.AsyncClient, db_session: AsyncSession, otp: respx.MockRouter
) -> None:
    late = [("005510017", "Budapest-Keleti", 85800), ("005513748", "Szolnok", 90000)]
    rows = [_obs(i, 0, trip="1:late", train="1999 sz", stations=late) for i in range(2)]
    await _seed(db_session, rows, late)
    _timetable(otp, fail=True)

    url = "/v1/history/runs/1999/2026-10-28"
    assert (await client.get(url)).status_code == 404
    body = (await client.get(f"{url}?from=005513748")).json()
    assert body["serviceDate"] == "2026-10-27"


async def test_the_run_seen_at_most_stops_wins(
    client: httpx.AsyncClient, db_session: AsyncSession, otp: respx.MockRouter
) -> None:
    rows = [_obs(0, 60, trip="1:a")] + [_obs(i, 600, trip="1:b") for i in range(3)]
    await _seed(db_session, rows)
    route = _timetable(otp)

    await client.get("/v1/history/runs/2614/2026-10-27")

    assert b'"1:b"' in route.calls[0].request.content


async def test_cancelled_run_from_the_live_trains(
    client: httpx.AsyncClient,
    redis: fakeredis.FakeAsyncRedis,
    otp: respx.MockRouter,
) -> None:
    trip = {
        "gtfsId": TRIP,
        "serviceDate": "2026-10-28",
        "tripShortName": "2614 személyvonat",
        "route": {"shortName": "x"},
        "stoptimes": _stoptimes(cancelled=True),
        "alerts": [],
    }
    at = service_day_start(date(2026, 10, 28)) + timedelta(hours=7)
    await redis.hset(  # type: ignore[misc]
        add_key("train-positions-hash"),
        "v1",
        json.dumps(
            {"vehicleId": "v1", "lastUpdated": int(at.timestamp()), "trip": trip}
        ),
    )

    r = await client.get("/v1/history/runs/2614/2026-10-28")

    assert r.status_code == 200
    body = r.json()
    assert body["cancelled"] is True
    assert all(s["delayMin"] is None for s in body["stops"])


@pytest.mark.parametrize(
    "path",
    [
        "/v1/history/runs/2614/2026-10-27",  # nothing recorded or live
        "/v1/history/runs/2614/2026-12-01",  # in the future
        "/v1/history/runs/2614/2024-01-01",  # older than the history
    ],
)
async def test_unknown_runs_are_404(
    client: httpx.AsyncClient, otp: respx.MockRouter, path: str
) -> None:
    assert (await client.get(path)).status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/v1/history/runs/26%2014/2026-10-27",
        "/v1/history/runs/2614/2026-13-01",
        "/v1/history/runs/2614/2026-10-27?from=abc",
    ],
)
async def test_bad_input_is_rejected(
    client: httpx.AsyncClient, otp: respx.MockRouter, path: str
) -> None:
    assert (await client.get(path)).status_code == 422


def test_shift_days_by_when_the_passages_were_seen() -> None:
    # Seen at 0:10 on the next day, for a 0:10 stoptime
    row = SimpleNamespace(
        scheduled_departure_s=600,
        scheduled_arrival_s=600,
        delay_s=0,
        observed_at=service_day_start(DAY + timedelta(days=1)) + timedelta(seconds=600),
    )
    run = run_summary._Run(DAY, "1:x", [row])
    assert run.effective_date == DAY + timedelta(days=1)
