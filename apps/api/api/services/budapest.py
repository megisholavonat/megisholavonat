"""Budapest's many rail stations, for search and the journey planner.

Only the four termini carry the "Budapest-" prefix; the other stations inside
the city (Kőbánya-Kispest, Zugló, ...) are found under "Budapest" as well,
and the planner offers "Budapest (any station)", planned from the city centre
with Budapest public transport to the trains.
"""

from api.schemas.stations import Station

# Pseudo-station id of "Budapest (any station)" in the journey planner
BUDAPEST_ID = "budapest"
# Deák Ferenc tér, where the three metro lines meet
BUDAPEST_CENTRE = (47.497912, 19.054916)

TERMINI = (
    "005510017",  # Budapest-Keleti
    "005510033",  # Budapest-Nyugati
    "005501024",  # Budapest-Kelenföld
    "005501016",  # Budapest-Déli
)

# Stations in the city without the prefix, the busiest (long-distance or
# main commuter stops) first
OTHER_STATIONS = (
    "005510173",  # Kőbánya-Kispest
    "005510090",  # Zugló
    "005510025",  # Ferencváros
    "005510066",  # Kőbánya felső
    "005510140",  # Rákospalota-Újpest
    "005510207",  # Újpest
    "005510124",  # Angyalföld
    "005501404",  # Óbuda
    "005513615",  # Ferihegy
    "005510199",  # Kispest
    # Suburban stops inside the city limits
    "005503111",  # Albertfalva
    "005503129",  # Budafok
    "005540543",  # Budatétény
    "005505785",  # Háros
    "005503135",  # Kastélypark
    "005547399",  # Barosstelep
    "005503145",  # Tétényliget
    "005505793",  # Nagytétény-Diósd
    "005510157",  # Kőbánya alsó
    "005510074",  # Rákos
    "005510082",  # Rákosrendező
    "005510132",  # Istvántelek
    "005541145",  # Vasútmúzeum
    "005510233",  # Újpalota
    "005540915",  # Rákospalota-Kertváros
    "005510181",  # Pestszentlőrinc
    "005516782",  # Pestszentimre
    "005510355",  # Pestszentimre felső
    "005513003",  # Szemeretelep
    "005511528",  # Rákoshegy
    "005541640",  # Rákoskert
    "005511080",  # Rákosliget
    "005511106",  # Rákoscsaba
    "005511098",  # Rákoscsaba-Újtelep
    "005511078",  # Akadémiaújtelep
    "005501408",  # Aranyvölgy
    "005540253",  # Aquincum
)

STATIONS = frozenset(TERMINI + OTHER_STATIONS)
# Rank of the stations found only through the city's name
OTHER_RANK = {uic: i for i, uic in enumerate(OTHER_STATIONS)}

# Roughly the city; used for HÉV stops (UIC prefix 0036), which are not
# listed above
_BBOX = (47.35, 18.93, 47.61, 19.33)
_HEV_PREFIX = "0036"


def is_budapest_station(uic: str | None, lat: float, lon: float) -> bool:
    """A MÁV station in the city, or a HÉV stop around it."""
    if uic is None:
        return False
    if uic in STATIONS:
        return True
    min_lat, min_lon, max_lat, max_lon = _BBOX
    return (
        uic.startswith(_HEV_PREFIX)
        and min_lat <= lat <= max_lat
        and min_lon <= lon <= max_lon
    )


def budapest_station() -> Station:
    """The pseudo-station; clients show their own name for it."""
    lat, lon = BUDAPEST_CENTRE
    return Station(id=BUDAPEST_ID, name="Budapest", lat=lat, lon=lon)
