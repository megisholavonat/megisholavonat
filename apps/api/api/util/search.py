import re
import unicodedata

_NON_ALNUM = re.compile(r"[^0-9a-z]+")


def normalize_search_text(text: str) -> str:
    """
    Accent- and case-insensitive form of a name, with punctuation collapsed to
    single spaces ("Budapest-Keleti" -> "budapest keleti", "Győr" -> "gyor").
    Mirrors `normalizeSearchText` in the web app.
    """
    decomposed = unicodedata.normalize("NFD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return _NON_ALNUM.sub(" ", stripped.lower()).strip()
