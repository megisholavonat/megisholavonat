import re
from pathlib import Path
from typing import get_args

import pytest

from api.schemas.alerts import DelayReason, RailAlert
from api.schemas.trains import Alert
from api.util.delay_reasons import (
    DELAY_REASON_PATTERNS,
    DELAY_REASON_TEXTS,
    DELAY_REASONS,
    DelayReasonCode,
    delay_reason_code,
    delay_reason_label,
)

CORE_REASONS = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "core"
    / "src"
    / "delayReasons.ts"
)


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("Pálya állapota miatti késés", "track"),
        ("  VONAT  műszaki hibája miatti késés. ", "technical"),
        ("Más vonat által okozott késés", "other_train"),
        ("Csatlakozásra várás miatti késés", "connection"),
    ],
)
def test_exact_match(text: str, code: str) -> None:
    assert delay_reason_code(text) == code


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("Győrben műszaki hiba miatt várakozik.", "technical"),
        (
            "Sülysápon hatósági intézkedés miatt várakozik. Utasai pótlóbusszal.",
            "police",
        ),
        (
            "A vonat a Kastélyparknál történt közúti baleset miatt várakozik",
            "accident",
        ),
        (
            "Várhatóan 15-20 perces késéssel érkezik a magyarországi szakaszra.",
            "partner_railway",
        ),
        (
            "Biztosítóberendezési hiba miatt a vonatok hosszabb menetidővel "
            "közlekednek.",
            "signalling",
        ),
    ],
)
def test_pattern_match(text: str, code: str) -> None:
    assert delay_reason_code(text) == code


@pytest.mark.parametrize(
    "text",
    [
        "Várhatóan 10 perces késéssel indul.",
        "Utolsó kocsija lezárva közlekedik, utazásra nem vehető igénybe.",
        "",
        None,
    ],
)
def test_unknown_is_none(text: str | None) -> None:
    assert delay_reason_code(text) is None


def test_locale_labels() -> None:
    assert delay_reason_label("technical") == "Műszaki hiba"
    assert delay_reason_label("technical", "en") == "Technical fault"
    assert delay_reason_label("weather", "en") == "Weather"
    assert set(DELAY_REASONS) == set(get_args(DelayReasonCode))


def test_schema_reason_fields() -> None:
    alert = Alert(
        alertDescriptionText="Időjárási ok miatti késés",
        effectiveStartDate=0,
        effectiveEndDate=1,
    )
    assert alert.model_dump()["reason"] == {"code": "weather", "label": "Időjárás"}

    rail_alert = RailAlert(
        id="a",
        description="Kisebb ülőhely-kapacitású szerelvénnyel közlekedik.",
        affectedRoutes=[],
        affectedTrips=[],
        affectedStations=[],
    )
    assert rail_alert.reason is None
    # Cached alerts carry the computed field; it must not break validation
    assert RailAlert.model_validate(rail_alert.model_dump()) == rail_alert

    assert DelayReason.from_texts(None, "x", "Baleset miatti késés") == DelayReason(
        code="accident", label="Baleset"
    )


def _ts_block(source: str, declaration: str) -> str:
    """Source of a top-level `export` declaration, up to the next blank line."""
    return source.split(f"export {declaration}")[1].split("\n\n")[0]


@pytest.mark.skipif(not CORE_REASONS.exists(), reason="core package not checked out")
def test_matches_core_package() -> None:
    source = CORE_REASONS.read_text()

    texts = dict(
        re.findall(
            r'"([^"]+)": "([a-z_]+)"', _ts_block(source, "const DELAY_REASON_TEXTS")
        )
    )
    assert texts == DELAY_REASON_TEXTS

    patterns = re.findall(
        r'\[\s*/(.+)/,\s*"([a-z_]+)",?\s*\]',
        _ts_block(source, "const DELAY_REASON_PATTERNS"),
    )
    assert patterns == DELAY_REASON_PATTERNS

    labels = {
        code: {"hu": hu, "en": en, "icon": icon}
        for code, hu, en, icon in re.findall(
            r'(\w+): \{\s*hu: "([^"]+)",\s*en: "([^"]+)",\s*icon: "([^"]+)",?\s*\}',
            _ts_block(source, "const DELAY_REASONS"),
        )
    }
    assert labels == DELAY_REASONS

    union = _ts_block(source, "type DelayReasonCode")
    assert set(re.findall(r'"([a-z_]+)"', union)) == set(get_args(DelayReasonCode))
