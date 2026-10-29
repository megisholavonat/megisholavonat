from types import SimpleNamespace
from typing import Any

import httpx
import pytest
import respx

from api.schemas.alerts import AlertRoute, AlertStation, AlertTrip, RailAlert
from api.services import alerts_service
from api.services.disruptions import (
    MAVINFORM_URL,
    TripStops,
    alert_cause,
    alert_effect,
    alert_kind,
    applies_at,
    find_segment,
    group_disruptions,
    severity_of,
    train_disruption,
    trains_of,
)
from tests.upstream import graphql_route, load_fixture, otp_responder

FIXTURE = "otp-alerts-disruptions.json"
# Moment the fixture was captured: 2026-10-29 03:55 in Budapest
CAPTURED_AT = 1793242530

MANDOK_NOTICE = "QWxlcnQ6MToxMjAwMg"  # "Alert:1:12002"
HEV_NOTICE = "QWxlcnQ6MTozNzQ5"  # "Alert:1:3749"
VERESEGYHAZ_NOTICE = "QWxlcnQ6MToxMjAyNw"  # "Alert:1:12027", over by capture


@pytest.fixture
def frozen_now(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    clock = SimpleNamespace(now=CAPTURED_AT)
    monkeypatch.setattr(alerts_service, "time", SimpleNamespace(time=lambda: clock.now))
    return clock


async def _disruptions(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    response = await client.get("/v1/alerts/disruptions")
    assert response.status_code == 200
    data: list[dict[str, Any]] = response.json()
    return data


async def test_only_line_disruptions_are_listed(
    client: httpx.AsyncClient, otp: respx.MockRouter, frozen_now: SimpleNamespace
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(alerts=FIXTURE))

    disruptions = await _disruptions(client)
    alerts = (await client.get("/v1/alerts")).json()

    # 30 active alerts: 15 delay reasons, 10 coach or delay notices of one
    # train, a replacement bus for one train, and two events
    assert len(alerts) == 30
    assert [d["id"] for d in disruptions] == [MANDOK_NOTICE, HEV_NOTICE]
    listed = {i for d in disruptions for i in d["alertIds"]}
    assert all(a["reason"] is None for a in alerts if a["id"] in listed)


async def test_alerts_of_one_stretch_are_merged(
    client: httpx.AsyncClient, otp: respx.MockRouter, frozen_now: SimpleNamespace
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(alerts=FIXTURE))

    mandok = (await _disruptions(client))[0]

    # The station notice plus one alert per direction listing the trains
    assert len(mandok["alertIds"]) == 3
    assert mandok["effect"] == "replacement_bus"
    assert mandok["severity"] == "high"
    assert mandok["scope"] == "line"
    assert mandok["segment"] == {
        "fromName": "Mándok",
        "toName": "Tornyospálca",
        "fromId": "005515875",
        "toId": "005515883",
    }
    assert mandok["title"] == "Pótlóbusz Mándok és Tornyospálca között"
    assert mandok["description"].startswith("Mándok-Tornyospálca állomások között")
    # The bus stops of each direction, once each
    assert len(mandok["details"]) == 2
    assert mandok["url"] == "https://www.mavcsoport.hu/mavinform"
    assert (mandok["start"], mandok["end"]) == (1793142000, 1793401140)
    assert len(mandok["trips"]) == 16
    assert len(mandok["stations"]) == 14
    # Four routes, all of them stopping trains: one glyph, no line name
    assert len(mandok["routes"]) == 4
    assert len(mandok["lines"]) == 1
    assert mandok["lines"][0]["name"] is None


async def test_hev_works_have_lines_and_cause(
    client: httpx.AsyncClient, otp: respx.MockRouter, frozen_now: SimpleNamespace
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(alerts=FIXTURE))

    hev = (await _disruptions(client))[1]

    assert hev["cause"] == "engineering"
    assert hev["effect"] == "replacement_bus"
    assert [line["name"] for line in hev["lines"]] == ["H8", "H9"]
    assert hev["segment"]["fromName"] == "Örs vezér tere"
    assert hev["segment"]["toName"] == "Cinkota"
    assert hev["end"] == 1794016740


async def test_train_follow_ups_join_the_station_notice(
    client: httpx.AsyncClient, otp: respx.MockRouter, frozen_now: SimpleNamespace
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(alerts=FIXTURE))
    frozen_now.now = 1793230000  # the Veresegyház accident was still on

    disruptions = await _disruptions(client)

    veresegyhaz = next(d for d in disruptions if d["id"] == VERESEGYHAZ_NOTICE)
    assert veresegyhaz["cause"] == "accident"
    # "Veresegyháztól pótlóbusszal utazhatnak", for two trains, and the
    # own notice of the train the accident hit, named "(2551)" in the text
    assert len(veresegyhaz["alertIds"]) == 4
    assert {t["tripShortName"].split()[0] for t in veresegyhaz["trips"]} == {
        "2510",
        "2551",
        "2598",
    }
    assert [line["name"] for line in veresegyhaz["lines"]] == ["S71"]
    assert len(disruptions) == 3


async def test_station_accident_notice_is_a_disruption(
    client: httpx.AsyncClient, otp: respx.MockRouter, frozen_now: SimpleNamespace
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder())
    frozen_now.now = 1793222600

    disruptions = await _disruptions(client)

    # "Nem közlekedik." about one train stays on the train
    assert len(disruptions) == 1
    assert disruptions[0]["cause"] == "accident"
    assert disruptions[0]["segment"]["fromName"] == "Ózd"
    assert disruptions[0]["segment"]["toName"] == "Miskolc"


def _alert(
    text: str,
    *,
    trips: int = 0,
    stations: list[str] | None = None,
    routes: list[tuple[str, str]] | None = None,
) -> RailAlert:
    return RailAlert(
        id=f"alert-{abs(hash((text, trips))) % 10_000}",
        description=text,
        start=100,
        end=200,
        affectedRoutes=[
            AlertRoute(id=f"1:{name}", shortName=glyph, longName=name, mode="RAIL")
            for glyph, name in routes or []
        ],
        affectedTrips=[
            AlertTrip(tripId=f"1:{i}", tripShortName=f"{i} személyvonat")
            for i in range(trips)
        ],
        affectedStations=[
            AlertStation(id=f"00{i}", name=name)
            for i, name in enumerate(stations or [])
        ],
    )


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("Vonat műszaki hibája miatti késés", "delay_reason"),
        ("Utolsó kettő kocsija lezárva közlekedik.", "train_notice"),
        ("Kisebb ülőhely-kapacitású szerelvénnyel közlekedik.", "train_notice"),
        ("Várhatóan 40 perc késéssel indul.", "train_notice"),
        ("Kerékpárszállítás nem lehetséges.", "train_notice"),
        # The bus stop list names a "kocsiállás"; still a replacement bus
        (
            "Pótlóbusszal utazhatnak. Vác, autóbusz állomás (14-es kocsiállás)",
            "disruption",
        ),
        ("Vágányzár miatt módosul a menetrend.", "disruption"),
    ],
)
def test_alert_kind(text: str, kind: str) -> None:
    assert alert_kind(_alert(text)) == kind


@pytest.mark.parametrize(
    ("text", "effect", "cause", "severity"),
    [
        ("Sztrájk miatt a vonatok nem közlekednek.", "no_service", "strike", "high"),
        (
            "A viharos időjárás miatt késésekre kell számítani.",
            "delays",
            "weather",
            "medium",
        ),
        (
            "Pályafelújítás miatt módosul a menetrend.",
            "modified_service",
            "engineering",
            "medium",
        ),
        ("A pénztár zárva tart.", "other", "other", "low"),
    ],
)
def test_effect_cause_and_severity(
    text: str, effect: str, cause: str, severity: str
) -> None:
    assert alert_effect(text) == effect
    assert alert_cause(text) == cause
    assert severity_of(alert_effect(text), alert_cause(text)) == severity


def test_segment_split_prefers_known_stations() -> None:
    ids = {"budapest nyugati": "005510017", "vac": "005510033"}

    segment = find_segment("Budapest-Nyugati-Vác között pótlóbusz közlekedik.", ids)

    assert segment is not None
    assert (segment.fromName, segment.toName) == ("Budapest-Nyugati", "Vác")
    assert (segment.fromId, segment.toId) == ("005510017", "005510033")


def test_single_train_notice_is_dropped() -> None:
    assert (
        group_disruptions([_alert("Gödöllőtől pótlóbusszal utazhatnak.", trips=1)])
        == []
    )


def test_notice_without_entities_is_network_wide() -> None:
    [strike] = group_disruptions(
        [_alert("Országos sztrájk miatt csak minden második vonat közlekedik.")]
    )

    assert strike.scope == "network"
    assert strike.severity == "high"
    assert strike.url == MAVINFORM_URL
    assert strike.title.startswith("Országos sztrájk")


def test_route_notice_names_its_lines() -> None:
    [works] = group_disruptions(
        [
            _alert(
                "Szob és Vác között vágányzár miatt módosul a menetrend. "
                "Részletek: www.mavcsoport.hu/mavinform/szob.",
                routes=[("<span>A</span>", "S70"), ("<span>B</span>", "Sz 2004/2006")],
            )
        ]
    )

    assert works.scope == "line"
    assert works.title == "Módosult menetrend Szob és Vác között"
    assert [line.name for line in works.lines] == ["S70", None]
    assert works.url == "https://www.mavcsoport.hu/mavinform/szob"


# --- Tapolca, 2026-10-29: a bus replaces 9759 and 9772 ---

TAPOLCA_NOTICE = "QWxlcnQ6MToxMjAyOA"
# 9759 leaves Tapolca at 4:41
DEPARTURE_9759 = 1793244060


def _tapolca() -> list[RailAlert]:
    return [
        RailAlert.model_validate(a) for a in load_fixture("rail-alerts-tapolca.json")
    ]


def test_tapolca_title_is_built_from_effect_and_stretch() -> None:
    [bus] = group_disruptions(_tapolca())

    assert bus.id == TAPOLCA_NOTICE
    # Not the description cut off mid-sentence
    assert bus.title == "Pótlóbusz Tapolca és Balatonfüred között"
    assert bus.segment is not None
    assert (bus.segment.fromId, bus.segment.toId) == ("005504598", "005504416")


def test_tapolca_lists_the_replaced_trains() -> None:
    [bus] = group_disruptions(_tapolca())

    # The trains' own notices join the event naming them "(9759)", "(9772)"
    assert sorted(t.tripShortName or "" for t in bus.trips) == [
        "9759 személyvonat",
        "9772 személyvonat",
    ]
    assert len(bus.alertIds) == 3
    # ... with their line glyph, but not their whole-day validity
    assert len(bus.lines) == 1
    assert (bus.start, bus.end) == (1793244060, 1793257680)


def test_board_marks_the_replaced_train() -> None:
    trains = trains_of(group_disruptions(_tapolca()))

    assert trains.of("1:35700565", "9759", DEPARTURE_9759) == "replacement_bus"
    # By its number alone, as named in the text
    assert trains.of("1:other", "9772", DEPARTURE_9759 + 3600) == "replacement_bus"
    # Other trains, and the same train another day, are not
    assert trains.of("1:other", "9761", DEPARTURE_9759) is None
    assert trains.of("1:35700565", "9759", DEPARTURE_9759 + 86400) is None


def test_board_marks_the_replaced_train_only_on_its_stretch() -> None:
    trains = trains_of(group_disruptions(_tapolca()))
    # A run going on past Balatonfüred, where the bus ends
    run = ["Tapolca", "Badacsonytomaj", "Révfülöp", "Balatonfüred", "Alsóörs"]

    def at(station: str) -> TripStops:
        return TripStops(run, run.index(station), departing=True)

    assert trains.of("1:x", "9759", DEPARTURE_9759, at("Révfülöp")) == (
        "replacement_bus"
    )
    assert trains.of("1:x", "9759", DEPARTURE_9759, at("Balatonfüred")) is None


# Stops of 3510 (Kőbánya-Kispest - Székesfehérvár) as OTP lists them
RUN_3510 = [
    "Kőbánya-Kispest",
    "Ferencváros",
    "Budapest-Kelenföld",
    "Budafok",
    "Budatétény",
    "Barosstelep",
    "Érdliget",
    "Érd felső",
    "Tárnok",
    "Martonvásár",
    "Baracska",
    "Kápolnásnyék",
    "Velence",
    "Velencefürdő",
    "Gárdony",
    "Agárd",
    "Székesfehérvár",
]


def _at(station: str, *, departing: bool = True) -> TripStops:
    return TripStops(RUN_3510, RUN_3510.index(station), departing)


def test_a_skipped_stop_marks_only_that_stop() -> None:
    text = "A vonat Kőbánya-Kispest megállóhelyen nem áll meg."

    assert train_disruption(text) == "no_service"
    assert applies_at(text, _at("Kőbánya-Kispest"))
    assert not applies_at(text, _at("Ferencváros"))
    assert not applies_at(text, _at("Budapest-Kelenföld", departing=False))
    # Notices may drop "Budapest-"
    kelenfold = "A vonat Kelenföld állomáson nem áll meg."
    assert applies_at(kelenfold, _at("Budapest-Kelenföld"))
    assert applies_at(kelenfold, _at("Budapest-Kelenföld", departing=False))
    assert not applies_at(kelenfold, _at("Budafok"))
    # A stop it cannot place marks nothing
    assert not applies_at("A vonat Sehol megállóhelyen nem áll meg.", _at("Budafok"))


def test_a_stretch_not_run_marks_only_stations_on_it() -> None:
    text = "A vonat Tárnok és Velence között nem közlekedik."

    assert train_disruption(text) == "no_service"
    # Leaving into the stretch, or arriving along it
    assert applies_at(text, _at("Tárnok"))
    assert applies_at(text, _at("Baracska"))
    assert applies_at(text, _at("Baracska", departing=False))
    assert applies_at(text, _at("Velence", departing=False))
    # Arriving before it, or leaving after it, the train runs
    assert not applies_at(text, _at("Tárnok", departing=False))
    assert not applies_at(text, _at("Velence"))
    assert not applies_at(text, _at("Budapest-Kelenföld"))
    assert not applies_at(text, _at("Székesfehérvár", departing=False))


def test_a_stretch_named_from_or_until_a_stop() -> None:
    onwards = "Velencétől pótlóbusszal utazhatnak."
    until = "Tárnokig pótlóbusz közlekedik."

    assert applies_at(onwards, _at("Velence"))
    assert applies_at(onwards, _at("Agárd"))
    assert not applies_at(onwards, _at("Martonvásár"))
    assert not applies_at(onwards, _at("Velence", departing=False))
    assert applies_at(until, _at("Ferencváros"))
    assert applies_at(until, _at("Tárnok", departing=False))
    assert not applies_at(until, _at("Tárnok"))


def test_a_notice_on_the_whole_run_marks_every_stop() -> None:
    for station in ("Kőbánya-Kispest", "Velence"):
        assert applies_at("Nem közlekedik.", _at(station))
        assert applies_at("Pótlóbusz közlekedik.", _at(station))
    # A stretch it cannot place
    assert applies_at("Sehol és Máshol között nem közlekedik.", _at("Velence"))
    # Without the run's stops, as before
    assert applies_at("A vonat Ferencváros megállóhelyen nem áll meg.", None)


@pytest.mark.parametrize(
    ("text", "disruption"),
    [
        (
            "Pótlóbusz közlekedik, mely várhatóan 20 perces késéssel indul.",
            "replacement_bus",
        ),
        ("Gödöllőtől pótlóbusszal utazhatnak.", "replacement_bus"),
        ("Nem közlekedik.", "no_service"),
        ("Kerékpárszállítás nem lehetséges.", None),
        ("Vonat műszaki hibája miatti késés", None),
        ("Várhatóan 40 perc késéssel indul.", None),
    ],
)
def test_train_disruption(text: str, disruption: str | None) -> None:
    assert train_disruption(text) == disruption


def test_from_to_segment_needs_known_stations() -> None:
    ids = {"tapolca": "005504598", "balatonfured": "005504416"}

    segment = find_segment(
        "A Tapolcáról 4:41-kor Balatonfüredre induló vonat helyett busz jár.", ids
    )
    unknown = find_segment("A Sehonnanról Seholsemre induló vonat.", ids)

    assert segment is not None
    # The display name drops the case ending and the lengthened vowel
    assert (segment.fromName, segment.toName) == ("Tapolca", "Balatonfüred")
    assert unknown is None


def test_long_first_sentence_is_never_cut() -> None:
    text = (
        "Járműhiba miatt a reggeli órákban a hegyi szakaszon közlekedő "
        "személyvonatok helyett a vasúttársaság pótlóbuszokat közlekedtet, "
        "részletek az állomásokon."
    )

    [bus] = group_disruptions([_alert(text, stations=["Valahol", "Máshol"])])

    assert bus.title == "Pótlóbusz"
