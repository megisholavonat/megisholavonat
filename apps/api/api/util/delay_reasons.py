"""Short labels for MÁV's per-train delay reason alerts.

Rail trips carry alerts such as "Pálya állapota miatti késés" in
`alertDescriptionText`. Known reasons map to a stable code and a one- or
two-word label for cards; anything else maps to None and is only shown in
full in detail views.

Mirrored in packages/core/src/delayReasons.ts; tests/test_delay_reasons.py
keeps the two in sync.
"""

import re
from collections.abc import Iterable
from typing import Literal, TypedDict

Locale = Literal["hu", "en"]

DelayReasonCode = Literal[
    "track",
    "technical",
    "other_train",
    "dwell",
    "partner_railway",
    "connection",
    "signalling",
    "external",
    "weather",
    "construction",
    "accident",
    "switch",
    "operational",
    "overhead_line",
    "police",
    "vandalism",
    "replacement_bus",
]


class ReasonInfo(TypedDict):
    hu: str
    en: str
    # Suggested lucide icon name
    icon: str


DELAY_REASONS: dict[DelayReasonCode, ReasonInfo] = {
    "track": {"hu": "Pályahiba", "en": "Track issue", "icon": "construction"},
    "technical": {"hu": "Műszaki hiba", "en": "Technical fault", "icon": "wrench"},
    "other_train": {"hu": "Más vonat", "en": "Other train", "icon": "train-front"},
    "dwell": {"hu": "Hosszú állás", "en": "Long dwell", "icon": "timer"},
    "partner_railway": {"hu": "Társvasút", "en": "Partner railway", "icon": "globe"},
    "connection": {
        "hu": "Csatlakozásra vár",
        "en": "Held for connection",
        "icon": "git-merge",
    },
    "signalling": {"hu": "Jelzőhiba", "en": "Signal fault", "icon": "traffic-cone"},
    "external": {"hu": "Külső ok", "en": "External cause", "icon": "circle-alert"},
    "weather": {"hu": "Időjárás", "en": "Weather", "icon": "cloud-lightning"},
    "construction": {
        "hu": "Pályaépítés",
        "en": "Engineering works",
        "icon": "hard-hat",
    },
    "accident": {"hu": "Baleset", "en": "Accident", "icon": "siren"},
    "switch": {"hu": "Váltóhiba", "en": "Points failure", "icon": "split"},
    "operational": {"hu": "Forgalmi ok", "en": "Operational", "icon": "list-ordered"},
    "overhead_line": {"hu": "Felsővezeték", "en": "Overhead line", "icon": "zap-off"},
    "police": {"hu": "Hatósági intézkedés", "en": "Police action", "icon": "shield"},
    "vandalism": {"hu": "Rongálás", "en": "Vandalism", "icon": "hammer"},
    "replacement_bus": {"hu": "Pótlóbusz", "en": "Replacement bus", "icon": "bus"},
}

# Normalised alert text (see normalize_alert_text) -> reason code
DELAY_REASON_TEXTS: dict[str, DelayReasonCode] = {
    "pálya állapota miatti késés": "track",
    "vonat műszaki hibája miatti késés": "technical",
    "műszaki ok miatti késés vonatnál": "technical",
    "más vonat által okozott késés": "other_train",
    "más vonattól átvett késés": "other_train",
    "tartózkodási idő túllépése": "dwell",
    "társvasúttól átvett késés": "partner_railway",
    "csatlakozásra várás miatti késés": "connection",
    "biztosítóberendezési hiba miatti késés": "signalling",
    "biztosítóberendezési meghibásodás miatti késés": "signalling",
    "vasútüzemen kívülálló ok miatti késés": "external",
    "időjárási ok miatti késés": "weather",
    "pályaépítés miatti késés": "construction",
    "baleset miatti késés": "accident",
    "váltó meghibásodás miatti késés": "switch",
    "forgalmi ok miatti késés": "operational",
    "felsővezetéki hiba miatti késés": "overhead_line",
    "hatósági intézkedés miatti késés": "police",
    "rongálás miatti késés": "vandalism",
    "vonatpótló busz miatti késés": "replacement_bus",
}

# Templated variants, matched in order against the normalised text. Kept to
# syntax that means the same in Python and JavaScript (no \b, \w or \s).
#
# "<where> <cause> miatt várakozik", e.g. "Győrben műszaki hiba miatt
# várakozik", where <where> is an optional short place phrase.
_WAITING = "^(?:a vonat )?(?:[^.]{1,60} )?(?:%s) miatt várakozik"
DELAY_REASON_WAITING_CAUSES: list[tuple[str, DelayReasonCode]] = [
    ("műszaki (?:hiba|ok|meghibásodás|hibás szerelvény)", "technical"),
    ("felsővezeték(?:i hiba|-szakadás| szakadás)", "overhead_line"),
    ("(?:közúti )?baleset", "accident"),
    ("(?:hatósági|rendőri) intézkedés", "police"),
    ("biztosítóberendezési (?:hiba|meghibásodás)", "signalling"),
]
DELAY_REASON_PATTERNS: list[tuple[str, DelayReasonCode]] = [
    *((_WAITING % cause, code) for cause, code in DELAY_REASON_WAITING_CAUSES),
    # HÉV: "Biztosítóberendezési hiba miatt a vonatok hosszabb menetidővel
    # közlekednek."
    (
        "^biztosítóberendezési hiba miatt a vonatok hosszabb menetidővel"
        " közleked(?:het)?nek$",
        "signalling",
    ),
    # International trains: "Várhatóan 20 perces késéssel érkezik a
    # magyarországi szakaszra."
    (
        "^várhatóan [0-9]+(?:-[0-9]+)? perces késéssel érkezik"
        " a magyarországi szakaszra$",
        "partner_railway",
    ),
]

_COMPILED_PATTERNS = [(re.compile(p), code) for p, code in DELAY_REASON_PATTERNS]


def normalize_alert_text(text: str) -> str:
    """Collapse whitespace, lowercase and drop trailing full stops."""
    return " ".join(text.split()).lower().rstrip(". ")


def delay_reason_code(text: str | None) -> DelayReasonCode | None:
    """Reason code of an alert text, or None if it is not a known reason."""
    if not text:
        return None
    normalized = normalize_alert_text(text)
    code = DELAY_REASON_TEXTS.get(normalized)
    if code is not None:
        return code
    for pattern, pattern_code in _COMPILED_PATTERNS:
        if pattern.search(normalized):
            return pattern_code
    return None


def delay_reason_label(code: DelayReasonCode, locale: Locale = "hu") -> str:
    return DELAY_REASONS[code][locale]


def first_delay_reason_code(
    texts: Iterable[str | None],
) -> DelayReasonCode | None:
    """First known reason among several alert texts."""
    for text in texts:
        code = delay_reason_code(text)
        if code is not None:
            return code
    return None
