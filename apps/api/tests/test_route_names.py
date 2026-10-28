import re
from pathlib import Path

import pytest

from api.util.route_names import MAV_ROUTE_MAP, is_line, route_code, route_name

CORE_ROUTES = (
    Path(__file__).resolve().parents[3] / "packages" / "core" / "src" / "mavRoutes.ts"
)


@pytest.mark.parametrize(
    ("short_name", "code", "name"),
    [
        ('<span class="MNR2007">&#335;</span>', 335, "S10"),
        ('<span class="MNR2007">&#x14f;</span>', 335, "S10"),
        ("<span>ŏ</span>", 335, "S10"),
        ('<span class="MNR2007">&#611;</span>', 611, "IC"),
        ("S10", None, "S10"),
        ('<span class="MNR2007">&#1;</span>', 1, None),
        ("", None, None),
        (None, None, None),
    ],
)
def test_route_names(
    short_name: str | None, code: int | None, name: str | None
) -> None:
    assert route_code(short_name) == code
    assert route_name(short_name) == name


@pytest.mark.parametrize(
    ("name", "line"),
    [
        ("S10", True),
        ("Z430", True),
        ("IR85", True),
        ("H5", True),
        ("H8SZ", True),
        ("IC", False),
        ("Sz", False),
        ("Gy", False),
        ("rjx", False),
        ("IR", False),
        ("MÁV", False),
        ("TramTrain", False),
        ("", False),
        (None, False),
    ],
)
def test_is_line(name: str | None, line: bool) -> None:
    assert is_line(name) is line


@pytest.mark.skipif(not CORE_ROUTES.exists(), reason="core package not checked out")
def test_route_map_matches_core_package() -> None:
    source = CORE_ROUTES.read_text()
    body = source.split("MAV_ROUTE_MAP")[1].split("};")[0]
    core = {int(k): v for k, v in re.findall(r'(\d+): "([^"]+)"', body)}
    assert core == MAV_ROUTE_MAP
