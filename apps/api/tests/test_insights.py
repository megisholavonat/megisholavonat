import json
from datetime import UTC, date, datetime, timedelta
from typing import Any

import fakeredis
import httpx
import pytest
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.history import Stop, StopDelayObservation
from api.services import insights, station_index
from api.services.history import ensure_partition

# "Today" for every test; observations are seeded relative to it
MONDAY = date(2026, 9, 7)
KELETI = "005510017"
SZOLNOK = "005510009"
DEBRECEN = "005510710"
NAMES = {KELETI: "Budapest-Keleti", SZOLNOK: "Szolnok", DEBRECEN: "Debrecen"}


@pytest.fixture(autouse=True)
def _today_is_monday(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(insights, "today", lambda: MONDAY)


def _obs(
    delay_s: int,
    *,
    day: date = MONDAY,
    trip: str | None = None,
    train: str = "10 TRANSCARPATHIA",
    route: str = "IC",
    station: str = KELETI,
    seq: int = 0,
    platform: str | None = "1",
    scheduled_s: int = 8 * 3600,
    observed_at: datetime | None = None,
) -> dict[str, Any]:
    return {
        "service_date": day,
        "trip_gtfs_id": trip or f"1:{train.split()[0]}-{station}-{delay_s}-{seq}",
        "stop_sequence": seq,
        "trip_short_name": train,
        "route_short_name": route,
        "stop_id": f"1:{station}_{platform or 0}",
        "station_id": station,
        "scheduled_arrival_s": scheduled_s,
        "scheduled_departure_s": scheduled_s,
        "delay_s": delay_s,
        "platform": platform,
        "observed_at": observed_at
        or datetime.combine(day, datetime.min.time(), tzinfo=UTC)
        + timedelta(seconds=scheduled_s),
    }


async def _seed(session: AsyncSession, rows: list[dict[str, Any]]) -> None:
    stops = {
        r["stop_id"]: {
            "gtfs_id": r["stop_id"],
            "station_id": r["station_id"],
            "name": NAMES.get(r["station_id"], r["station_id"]),
            "lat": 47.0,
            "lon": 19.0,
            # Domestic stops have a county, foreign ones none
            "county": "Pest" if r["station_id"] in NAMES else None,
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


def _runs(delays: list[int], **kwargs: Any) -> list[dict[str, Any]]:
    """One observation per day, going back from MONDAY."""
    return [
        _obs(d, day=MONDAY - timedelta(days=i), trip=f"1:run{i}", **kwargs)
        for i, d in enumerate(delays)
    ]


# --- Train at station ---


async def test_train_station_median_and_percentile(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(db_session, _runs([0, 60, 120, 180, 600, 1200]))

    r = await client.get(f"/v1/history/trains/10/stations/{KELETI}")

    assert r.status_code == 200
    body = r.json()
    assert body["n"] == 6
    assert body["stationName"] == "Budapest-Keleti"
    # percentile_cont: halfway between 120 s and 180 s
    assert body["medianDelayMin"] == 2.5
    # 0.8 * 5 = position 4 -> 600 s
    assert body["p80DelayMin"] == 10.0
    assert body["onTimeShare"] == pytest.approx(4 / 6, abs=1e-3)
    assert body["insufficientData"] is False
    assert body["window"] == {"start": "2026-08-11", "end": "2026-09-07", "days": 28}


async def test_on_time_threshold_is_inclusive_at_five_minutes(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(db_session, _runs([299, 300, 301, 360, -60]))

    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()

    # -60, 299 and 300 are on time; 301 and 360 are not
    assert body["onTimeShare"] == 0.6


async def test_insufficient_data_below_five_samples(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(db_session, _runs([60, 60, 60, 60]))
    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()
    assert body["n"] == 4
    assert body["insufficientData"] is True
    assert body["medianDelayMin"] == 1.0


async def test_five_samples_are_sufficient(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(db_session, _runs([60, 60, 60, 60, 60]))
    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()
    assert body["insufficientData"] is False


async def test_no_data_is_insufficient(client: httpx.AsyncClient) -> None:
    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()
    assert body["n"] == 0
    assert body["insufficientData"] is True
    assert body["medianDelayMin"] is None
    assert body["typicalPlatform"] is None


async def test_weekday_weekend_split(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # MONDAY - 2 is a Saturday and MONDAY - 1 a Sunday
    await _seed(db_session, _runs([0, 600, 900, 0, 0, 0, 0, 0]))

    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()

    assert body["n"] == 8
    assert body["weekend"]["n"] == 2
    assert body["weekend"]["medianDelayMin"] == 12.5
    assert body["weekend"]["insufficientData"] is True
    assert body["weekday"]["n"] == 6
    assert body["weekday"]["onTimeShare"] == 1.0


async def test_public_holidays_count_as_weekend(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # Thu 20 Aug 2026 is State Foundation Day, Fri 21 Aug a bridge day;
    # Wed 19 and Mon 24 Aug are working days
    days = [date(2026, 8, d) for d in (19, 20, 21, 24)]
    await _seed(
        db_session,
        [_obs(60 * i, day=d, trip=f"1:run{i}") for i, d in enumerate(days)],
    )

    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()

    assert body["weekday"]["n"] == 2
    assert body["weekday"]["medianDelayMin"] == 1.5  # 0 and 3 minutes
    assert body["weekend"]["n"] == 2
    assert body["weekend"]["medianDelayMin"] == 1.5  # 1 and 2 minutes
    assert body["n"] == 4


def test_public_holidays_in_window() -> None:
    found = insights.public_holidays(date(2026, 8, 1), date(2027, 1, 1))
    assert date(2026, 8, 20) in found
    assert date(2026, 10, 23) in found
    assert date(2027, 1, 1) in found
    assert date(2026, 8, 19) not in found


async def test_train_number_is_the_first_token_only(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(
        db_session,
        _runs([60] * 5) + _runs([900] * 5, train="100 Other", seq=1),
    )
    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()
    assert body["n"] == 5
    assert body["medianDelayMin"] == 1.0


async def test_window_counts_back_from_today(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # Ten runs, one per day up to today; a 3-day window keeps the last three
    await _seed(db_session, _runs([0, 0, 0, 600, 600, 600, 600, 600, 600, 600]))

    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}?days=3")).json()

    assert body["n"] == 3
    assert body["medianDelayMin"] == 0.0
    assert body["window"] == {"start": "2026-09-05", "end": "2026-09-07", "days": 3}


async def test_window_ignores_older_data_even_without_recent_data(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Recording stopped a month before today: nothing is in the window
    await _seed(db_session, _runs([60] * 5))
    monkeypatch.setattr(insights, "today", lambda: MONDAY + timedelta(days=30))

    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()

    assert body["n"] == 0
    assert body["insufficientData"] is True


# --- Train route ---


async def test_train_route_in_schedule_order_without_rare_stations(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    rows = []
    for i in range(4):
        day, trip = MONDAY - timedelta(days=i), f"1:run{i}"
        rows += [
            _obs(0, day=day, trip=trip, station=KELETI, seq=0, scheduled_s=8 * 3600),
            _obs(
                120 * i,
                day=day,
                trip=trip,
                station=SZOLNOK,
                seq=5,
                scheduled_s=9 * 3600,
            ),
            _obs(
                600, day=day, trip=trip, station=DEBRECEN, seq=9, scheduled_s=11 * 3600
            ),
        ]
    # Diverted once via an unusual station
    rows.append(_obs(0, trip="1:run0", station="005599999", seq=7, scheduled_s=36000))
    await _seed(db_session, rows)

    body = (await client.get("/v1/history/trains/10")).json()

    assert body["runs"] == 4
    assert body["tripShortName"] == "10 TRANSCARPATHIA"
    assert body["routeShortName"] == "IC"
    assert [s["stationId"] for s in body["stations"]] == [KELETI, SZOLNOK, DEBRECEN]
    szolnok = body["stations"][1]
    assert szolnok["stationName"] == "Szolnok"
    assert szolnok["scheduledTimeS"] == 9 * 3600
    assert szolnok["n"] == 4
    assert szolnok["medianDelayMin"] == 3.0  # 0, 120, 240, 360 s
    assert szolnok["insufficientData"] is True


# --- Rankings ---


async def _seed_stations(db_session: AsyncSession) -> None:
    rows = []
    # KELETI: 9/10 on time, SZOLNOK: 5/10, DEBRECEN: 2/10, tiny station: 0/3
    for station, late in ((KELETI, 1), (SZOLNOK, 5), (DEBRECEN, 8)):
        rows += [
            _obs(900 if i < late else 60, station=station, seq=i, train=f"{i} T")
            for i in range(10)
        ]
    rows += [_obs(1800, station="005599999", seq=i) for i in range(3)]
    await _seed(db_session, rows)


async def test_rankings_best_and_worst_respect_min_samples(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed_stations(db_session)

    best = (await client.get("/v1/rankings?kind=stations&minSamples=5")).json()
    worst = (
        await client.get("/v1/rankings?kind=stations&order=worst&minSamples=5")
    ).json()
    everything = (
        await client.get("/v1/rankings?kind=stations&order=worst&minSamples=1")
    ).json()

    assert [e["id"] for e in best["entries"]] == [KELETI, SZOLNOK, DEBRECEN]
    assert [e["rank"] for e in best["entries"]] == [1, 2, 3]
    assert best["entries"][0] == {
        "rank": 1,
        "id": KELETI,
        "name": "Budapest-Keleti",
        "routeShortName": None,
        "n": 10,
        "onTimeShare": 0.9,
        "medianDelayMin": 1.0,
    }
    assert [e["id"] for e in worst["entries"]] == [DEBRECEN, SZOLNOK, KELETI]
    assert everything["entries"][0]["id"] == "005599999"
    assert len(everything["entries"]) == 4


@pytest.mark.parametrize(
    ("kind", "route", "train", "default"),
    [
        ("stations", "S10", "10 X", 100),
        ("lines", "S10", "10 X", 30),
        ("trains", "S10", "10 X", 15),
    ],
)
async def test_rankings_min_samples_default_per_kind(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    kind: str,
    route: str,
    train: str,
    default: int,
) -> None:
    # Exactly the default for one entry, one short of it for another; lines
    # and trains count runs, so every observation is its own run here
    rows = [
        _obs(0, route=route, train=train, station=KELETI, seq=i) for i in range(default)
    ]
    rows += [
        _obs(0, route="Z30", train="20 Y", station=SZOLNOK, seq=i)
        for i in range(default - 1)
    ]
    await _seed(db_session, rows)

    body = (await client.get(f"/v1/rankings?kind={kind}")).json()

    assert body["minSamples"] == default
    assert [e["n"] for e in body["entries"]] == [default]


async def test_rankings_tie_on_share_broken_by_median(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    rows = [_obs(240, station=KELETI, seq=i) for i in range(5)]
    rows += [_obs(30, station=SZOLNOK, seq=i) for i in range(5)]
    await _seed(db_session, rows)

    best = (await client.get("/v1/rankings?minSamples=5")).json()
    worst = (await client.get("/v1/rankings?order=worst&minSamples=5")).json()

    assert [e["id"] for e in best["entries"]] == [SZOLNOK, KELETI]
    assert [e["id"] for e in worst["entries"]] == [KELETI, SZOLNOK]


def _glyph(code: int) -> str:
    return f'<span class="MNR2007">&#{code};</span>'


async def test_rankings_merge_glyphs_of_the_same_line(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # 383 and 395 are both Z51; 335 is S10
    rows = [_obs(0, route=_glyph(383), seq=i) for i in range(3)]
    rows += [_obs(600, route=_glyph(395), seq=10 + i) for i in range(4)]
    rows += [_obs(0, route=_glyph(335), seq=20 + i) for i in range(5)]
    await _seed(db_session, rows)

    body = (await client.get("/v1/rankings?kind=lines&minSamples=5")).json()

    assert [
        (e["id"], e["name"], e["n"], e["onTimeShare"], e["routeShortName"])
        for e in body["entries"]
    ] == [
        ("S10", "S10", 5, 1.0, _glyph(335)),
        ("Z51", "Z51", 7, round(3 / 7, 3), _glyph(395)),
    ]


async def test_rankings_lines_keep_hev_but_not_train_categories(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # 440 is the H5 HEV line; 474 (IC), 484 (Sz) and 473 (Gy) are categories
    rows = [_obs(0, route=_glyph(440), seq=i) for i in range(5)]
    for j, code in enumerate((474, 484, 473)):
        rows += [_obs(0, route=_glyph(code), seq=10 * (j + 1) + i) for i in range(5)]
    # Plain-text names follow the same rule
    rows += [_obs(0, route="IC", seq=50 + i) for i in range(5)]
    await _seed(db_session, rows)

    body = (await client.get("/v1/rankings?kind=lines&minSamples=5")).json()

    assert [e["id"] for e in body["entries"]] == ["H5"]


async def test_rankings_by_line_and_train(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    rows = [_obs(0, route="S10", train="2001 Sz", seq=i) for i in range(5)]
    rows += [_obs(900, route="Z30", train="3001 Z", seq=i) for i in range(5)]
    # Unnamed routes are not a line
    rows += [_obs(0, route="", train="4001", seq=i) for i in range(5)]
    await _seed(db_session, rows)

    lines = (await client.get("/v1/rankings?kind=lines&minSamples=5&limit=1")).json()
    trains = (
        await client.get("/v1/rankings?kind=trains&order=worst&minSamples=5")
    ).json()

    assert [e["id"] for e in lines["entries"]] == ["S10"]
    assert lines["entries"][0]["routeShortName"] == "S10"
    assert [(e["id"], e["name"]) for e in trains["entries"]] == [
        ("3001", "3001 Z"),
        ("2001", "2001 Sz"),
        ("4001", "4001"),
    ]


async def test_line_and_train_rankings_use_the_arrival_of_each_run(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    rows = []
    for i in range(5):
        day, trip = MONDAY - timedelta(days=i), f"1:run{i}"
        # Train 10 (Z30) leaves on time but arrives 15 minutes late
        rows += [
            _obs(0, day=day, trip=trip, route="Z30", station=KELETI, seq=0),
            _obs(0, day=day, trip=trip, route="Z30", station=SZOLNOK, seq=5),
            _obs(900, day=day, trip=trip, route="Z30", station=DEBRECEN, seq=9),
        ]
        # Train 20 (S10) is late on the way but arrives on time
        twenty: dict[str, Any] = {
            "day": day,
            "trip": f"1:twenty{i}",
            "train": "20 X",
            "route": "S10",
        }
        rows += [
            _obs(900, **twenty, station=KELETI),
            _obs(60, **twenty, station=SZOLNOK, seq=3),
        ]
    # A run whose arrival was not recorded counts its last recorded stop
    rows += [
        _obs(0, trip="1:short", train="30 Y", route="S10", station=KELETI),
        _obs(420, trip="1:short", train="30 Y", route="S10", station=SZOLNOK, seq=4),
    ]
    await _seed(db_session, rows)

    trains = (await client.get("/v1/rankings?kind=trains&minSamples=5")).json()
    lines = (await client.get("/v1/rankings?kind=lines&minSamples=5")).json()
    stations = (await client.get("/v1/rankings?kind=stations&minSamples=5")).json()

    assert [(e["id"], e["n"], e["onTimeShare"]) for e in trains["entries"]] == [
        ("20", 5, 1.0),
        ("10", 5, 0.0),
    ]
    assert [(e["id"], e["n"], e["onTimeShare"]) for e in lines["entries"]] == [
        ("S10", 6, round(5 / 6, 3)),
        ("Z30", 5, 0.0),
    ]
    # Stations still count every passage
    assert sum(e["n"] for e in stations["entries"]) == 27


async def test_time_of_day(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    rows = [_obs(0, seq=i, scheduled_s=7 * 3600 + 60 * i) for i in range(3)]
    rows += [_obs(900, seq=10 + i, scheduled_s=17 * 3600) for i in range(2)]
    # After midnight of the service day counts as hour 0
    rows.append(_obs(0, seq=20, scheduled_s=24 * 3600 + 120))
    rows.append(_obs(900, seq=21, station=SZOLNOK, scheduled_s=7 * 3600))
    await _seed(db_session, rows)

    network = (await client.get("/v1/rankings/time-of-day")).json()
    keleti = (await client.get(f"/v1/rankings/time-of-day?stationId={KELETI}")).json()

    assert len(network["hours"]) == 24
    assert network["hours"][7]["n"] == 4
    assert network["hours"][7]["onTimeShare"] == 0.75
    assert keleti["hours"][7] == {
        "hour": 7,
        "n": 3,
        "onTimeShare": 1.0,
        "medianDelayMin": 0.0,
    }
    assert keleti["hours"][17]["onTimeShare"] == 0.0
    assert keleti["hours"][0]["n"] == 1
    assert keleti["hours"][12] == {
        "hour": 12,
        "n": 0,
        "onTimeShare": None,
        "medianDelayMin": None,
    }


# --- Platforms ---


async def test_platform_prediction_most_common(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(
        db_session,
        _runs([0], platform="2")
        + [_obs(0, day=MONDAY - timedelta(days=i), platform="5") for i in (1, 2, 3)]
        + _runs([0, 0], train="1001 Other", seq=1, platform=None),
    )

    body = (await client.get(f"/v1/history/stations/{KELETI}/platforms")).json()

    assert body["stationName"] == "Budapest-Keleti"
    # Passages without a platform are not predicted
    assert body["predictions"] == [
        {
            "trainNumber": "10",
            "tripShortName": "10 TRANSCARPATHIA",
            "routeShortName": "IC",
            "lineName": "IC",
            "platform": "5",
            "confidence": 0.75,
            "n": 4,
            # Below both the confidence and the runs needed
            "confident": False,
        }
    ]


@pytest.mark.parametrize(
    ("platforms", "confident"),
    [
        (["5"] * 5, True),
        (["5"] * 4 + ["2"], True),
        # Sure, but from too few runs
        (["5"] * 4, False),
        (["5"] * 6 + ["2"] * 2, False),
    ],
)
async def test_platform_prediction_confident(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    platforms: list[str],
    confident: bool,
) -> None:
    await _seed(
        db_session,
        [
            _obs(0, day=MONDAY - timedelta(days=i), trip=f"1:run{i}", platform=p)
            for i, p in enumerate(platforms)
        ],
    )

    body = (await client.get(f"/v1/history/stations/{KELETI}/platforms")).json()

    assert body["predictions"][0]["confident"] is confident


async def test_station_typical_delays(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(
        db_session,
        _runs([300, 360, 420, 480, 600])
        + _runs([0, 0, 30, 600, 0], train="20 X", seq=1)
        + _runs([240, 240], train="30 Y", seq=2),
    )

    body = (await client.get(f"/v1/history/stations/{KELETI}/platforms")).json()

    # Only trains with a median of a minute or more
    assert body["typicalDelays"] == [
        {
            "trainNumber": "10",
            "n": 5,
            "medianDelayMin": 7.0,
            "insufficientData": False,
        },
        {
            "trainNumber": "30",
            "n": 2,
            "medianDelayMin": 4.0,
            "insufficientData": True,
        },
    ]


async def test_platform_tie_goes_to_most_recent(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # Platform 3 twice in the older days, platform 6 twice in the newer
    rows = [
        _obs(0, day=MONDAY - timedelta(days=i), platform=p)
        for i, p in ((0, "6"), (1, "6"), (2, "3"), (3, "3"))
    ]
    # Same tie for train 20, newest first the other way round
    rows += [
        _obs(0, day=MONDAY - timedelta(days=i), platform=p, train="20 X", seq=1)
        for i, p in ((0, "3"), (1, "3"), (2, "6"), (3, "6"))
    ]
    await _seed(db_session, rows)

    body = (await client.get(f"/v1/history/stations/{KELETI}/platforms")).json()
    only_10 = (
        await client.get(f"/v1/history/stations/{KELETI}/platforms?trainNumber=10")
    ).json()
    keleti = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()

    assert [
        (p["trainNumber"], p["platform"], p["confidence"]) for p in body["predictions"]
    ] == [
        ("10", "6", 0.5),
        ("20", "3", 0.5),
    ]
    assert [p["trainNumber"] for p in only_10["predictions"]] == ["10"]
    assert keleti["typicalPlatform"] == "6"


async def test_responses_are_cached(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    await _seed(db_session, _runs([60] * 5))
    first = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()

    keys = await redis.keys("*")
    assert keys == [f"mhav-test:history:train-station:10:{KELETI}:28"]
    assert 0 < await redis.ttl(keys[0]) <= 600

    await _seed(db_session, _runs([900] * 5, seq=1))
    second = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()
    assert second == first


# --- Directory ---


async def test_directory_lists_regular_trains_and_served_domestic_stations(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    vienna = "008101001"
    await redis.set(
        station_index.index_key(),
        json.dumps(
            [
                [KELETI, "Budapest-Keleti", 47.5, 19.08],
                [SZOLNOK, "Szolnok", 47.17, 20.19],
                [DEBRECEN, "Debrecen", 47.52, 21.63],
                [vienna, "Wien Hbf", 48.18, 16.37],
            ]
        ),
    )
    await redis.set(station_index.index_version_key(), "1")
    # Daily at Keleti and in Vienna; Szolnok only once in four weeks
    await _seed(db_session, _runs([60] * 28))
    await _seed(db_session, _runs([60] * 28, station=vienna, train="40", seq=1))
    await _seed(db_session, _runs([60], station=SZOLNOK, train="7", seq=2))

    r = await client.get("/v1/history/directory")

    assert r.status_code == 200
    body = r.json()
    # Vienna is served but abroad (and in the index's rough box of Hungary);
    # Szolnok and Debrecen too seldom
    assert body["stations"] == [{"id": KELETI, "name": "Budapest-Keleti"}]
    # Train 7 ran once in 28 days: not regular
    assert body["trains"] == [
        {
            "trainNumber": "10",
            "tripShortName": "10 TRANSCARPATHIA",
            "routeShortName": "IC",
        },
        {"trainNumber": "40", "tripShortName": "40", "routeShortName": "IC"},
    ]
