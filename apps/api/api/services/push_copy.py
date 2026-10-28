"""
Notification copy: one terse line, Hungarian (informal) or English by the
device locale, e.g. "S70 · +12 perc · Kelenföld 14:32".
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

Lang = Literal["hu", "en"]

SEPARATOR = " · "


class AlertKind(StrEnum):
    DELAY = "delay"
    ON_TIME = "on_time"
    PLATFORM = "platform"
    TRAIN_AHEAD = "train_ahead"


@dataclass(frozen=True, slots=True)
class Alert:
    kind: AlertKind
    # DELAY: minutes late; TRAIN_AHEAD: how late the train ahead is
    delay_min: int | None = None
    # PLATFORM: the new platform
    platform: str | None = None


@dataclass(frozen=True, slots=True)
class TrainContext:
    """What every line ends with: which train, where and when the device boards."""

    label: str
    station: str
    # Scheduled local departure from the boarding station, "HH:MM"
    time: str


def lang_for(locale: str | None) -> Lang:
    """Hungarian unless the device asked for another language."""
    if locale is None or locale.split("-")[0].casefold() == "hu":
        return "hu"
    return "en"


def _part(alert: Alert, lang: Lang) -> str:
    match alert.kind:
        case AlertKind.DELAY:
            return (
                f"+{alert.delay_min} perc"
                if lang == "hu"
                else f"+{alert.delay_min} min"
            )
        case AlertKind.ON_TIME:
            return "újra időben" if lang == "hu" else "back on time"
        case AlertKind.PLATFORM:
            return (
                f"új vágány: {alert.platform}"
                if lang == "hu"
                else f"new platform: {alert.platform}"
            )
        case AlertKind.TRAIN_AHEAD:
            return (
                f"előző vonat +{alert.delay_min} perc"
                if lang == "hu"
                else f"train ahead +{alert.delay_min} min"
            )


def render(
    alerts: list[Alert], train: TrainContext, lang: Lang
) -> tuple[str, str | None]:
    """(title, body) of one notification carrying all of `alerts`."""
    parts = [train.label, *(_part(a, lang) for a in alerts)]
    parts.append(f"{train.station} {train.time}".strip())
    title = SEPARATOR.join(p for p in parts if p)
    body = None
    if any(a.kind == AlertKind.TRAIN_AHEAD for a in alerts):
        body = "A tiéd is késhet." if lang == "hu" else "Yours may be late too."
    return title, body
