"""
Features shared by training (from stop_delay_observations) and serving (from
the live positions), so both build exactly the same matrix.

An example is "a train that has just passed stop i with delay d at time now;
what will its delay be when it passes upcoming stop j?". The model predicts
the change `delay at j - d`; history is the c1 baseline (median change of
similar past examples), which also serves as the fallback when there is no
model.
"""

import hashlib
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

import holidays
import numpy as np
import numpy.typing as npt

FloatArray = npt.NDArray[np.float64]
KeyArray = npt.NDArray[np.uint64]

# Upcoming stops further ahead than this are not predicted
MAX_HORIZON_S = 3 * 3600
HORIZON_BUCKET_S = 5 * 60
# Minimum examples behind a history median, per level
HISTORY_MIN_COUNT = (3, 5, 1)

# Columns every example carries, as float64 (NaN = missing)
COLUMNS = (
    "delay_s",  # current GPS delay
    "otp_delay_s",  # OTP's delay estimate for the last passed stop
    "horizon_s",  # expected seconds until the train passes the target stop
    "sched_remaining_s",  # scheduled seconds from where the train is to the target
    "origin_seq",  # index of the last passed stop
    "target_seq",
    "hour",  # local hour of the observation
    "daytype",  # ISO weekday 1..7, public holidays count as Sunday
    "product",  # train product code, see PRODUCTS
    "is_terminus",  # target is the trip's final stop
)

FEATURES = (
    "delay_s",
    "otp_delay_s",
    "otp_minus_delay_s",
    "horizon_s",
    "sched_remaining_s",
    "stops_ahead",
    "origin_seq",
    "hour",
    "daytype",
    "product",
    "is_terminus",
    "history_s",
    "history_level",
)

# (pattern on the lowercased name without the train number, product code)
PRODUCTS: tuple[tuple[str, int], ...] = (
    (r"\bhév\b", 1),
    (r"tramtrain", 2),
    (r"bagolyvonat", 3),
    (r"személyvonat", 4),
    (r"interrégió", 5),
    (r"intercity|\bic\b", 6),
    (r"expressz", 7),
    (r"sebesvonat", 8),
    (r"railjet|eurocity|euronight|\bec\b|\ben\b|\brjx?\b", 9),
)
OTHER_PRODUCT = 0


def product_code(trip_short_name: str) -> int:
    name = re.sub(r"^\S+\s*", "", trip_short_name.lower())
    for pattern, code in PRODUCTS:
        if re.search(pattern, name):
            return code
    return OTHER_PRODUCT


_holiday_cache: dict[int, set[date]] = {}


def daytype(service_date: date) -> int:
    """ISO weekday, with Hungarian public holidays counted as Sunday (7)."""
    year = service_date.year
    if year not in _holiday_cache:
        _holiday_cache[year] = set(holidays.country_holidays("HU", years=year))
    return 7 if service_date in _holiday_cache[year] else service_date.isoweekday()


def stable_hash(values: Iterable[str]) -> KeyArray:
    """64-bit hash of each string that is stable across processes."""
    return np.array(
        [
            int.from_bytes(hashlib.blake2b(v.encode(), digest_size=8).digest())
            for v in values
        ],
        dtype=np.uint64,
    )


def hash_strings(values: Sequence[str]) -> KeyArray:
    """stable_hash for a column with repeats (hashes each distinct value once)."""
    uniq, inverse = np.unique(np.asarray(values, dtype=object), return_inverse=True)
    return stable_hash(uniq)[inverse]


_MIX = np.uint64(0x9E3779B97F4A7C15)


def _combine(a: KeyArray, *parts: npt.NDArray[np.integer]) -> KeyArray:
    k = a.astype(np.uint64)
    with np.errstate(over="ignore"):
        for p in parts:
            k = (k ^ p.astype(np.uint64)) * _MIX + np.uint64(1)
    return k


@dataclass
class Examples:
    """Columnar examples. `short_key` hashes the train name, `station_key` the
    target station. `target_s` (the delay at the target stop) is only set for
    training data."""

    cols: dict[str, FloatArray]
    short_key: KeyArray
    station_key: KeyArray
    target_s: FloatArray | None = None

    def __len__(self) -> int:
        return len(self.short_key)

    def take(self, idx: npt.NDArray[np.integer] | npt.NDArray[np.bool_]) -> "Examples":
        return Examples(
            cols={k: v[idx] for k, v in self.cols.items()},
            short_key=self.short_key[idx],
            station_key=self.station_key[idx],
            target_s=None if self.target_s is None else self.target_s[idx],
        )

    def compact(self) -> "Examples":
        """float32 copy for keeping many examples in memory. Every column holds
        whole seconds or small integers, so nothing is lost."""
        return Examples(
            cols={k: v.astype(np.float32) for k, v in self.cols.items()},  # type: ignore[misc]
            short_key=self.short_key,
            station_key=self.station_key,
            target_s=None
            if self.target_s is None
            else self.target_s.astype(np.float32),  # type: ignore[arg-type]
        )

    @classmethod
    def concat(cls, parts: Sequence["Examples"]) -> "Examples":
        if not parts:
            return empty_examples(with_target=True)
        targets = [p.target_s for p in parts]
        return cls(
            cols={k: np.concatenate([p.cols[k] for p in parts]) for k in parts[0].cols},
            short_key=np.concatenate([p.short_key for p in parts]),
            station_key=np.concatenate([p.station_key for p in parts]),
            target_s=None
            if any(t is None for t in targets)
            else np.concatenate(targets),  # type: ignore[arg-type]
        )


def empty_examples(with_target: bool = False) -> Examples:
    return Examples(
        cols={k: np.empty(0) for k in COLUMNS},
        short_key=np.empty(0, dtype=np.uint64),
        station_key=np.empty(0, dtype=np.uint64),
        target_s=np.empty(0) if with_target else None,
    )


def horizon_bucket(horizon_s: FloatArray) -> npt.NDArray[np.int64]:
    hb = np.floor(np.nan_to_num(horizon_s) / HORIZON_BUCKET_S)
    return np.clip(hb, 0, MAX_HORIZON_S // HORIZON_BUCKET_S).astype(np.int64)


def history_keys(ex: Examples) -> tuple[KeyArray, KeyArray, KeyArray]:
    """c1 lookup keys, most to least specific: (train, origin, target),
    (target station, product, horizon bucket), (horizon bucket)."""
    c = ex.cols
    hb = horizon_bucket(c["horizon_s"])
    k1 = _combine(
        ex.short_key, c["origin_seq"].astype(np.int64), c["target_seq"].astype(np.int64)
    )
    k2 = _combine(ex.station_key, c["product"].astype(np.int64), hb)
    k3 = _combine(np.zeros(len(ex), dtype=np.uint64), hb)
    return k1, k2, k3


@dataclass
class HistoryTable:
    """Sorted hashed keys with the median delay change behind each."""

    keys: KeyArray
    values: npt.NDArray[np.float32]

    def lookup(self, q: KeyArray) -> tuple[FloatArray, npt.NDArray[np.bool_]]:
        if self.keys.size == 0:
            return np.zeros(q.size), np.zeros(q.size, dtype=bool)
        pos = np.clip(np.searchsorted(self.keys, q), 0, self.keys.size - 1)
        found = self.keys[pos] == q
        return np.where(found, self.values[pos], 0.0).astype(np.float64), found


def median_table(
    keys: KeyArray, values: npt.NDArray[np.floating], min_count: int
) -> HistoryTable:
    """Median of `values` per distinct key, for keys seen at least min_count times."""
    if keys.size == 0:
        return HistoryTable(np.empty(0, np.uint64), np.empty(0, np.float32))
    uniq, inverse, counts = np.unique(keys, return_inverse=True, return_counts=True)
    order = np.lexsort((values, inverse))
    v = values[order]
    starts = np.concatenate(([0], np.cumsum(counts)[:-1]))
    med = (v[starts + (counts - 1) // 2] + v[starts + counts // 2]) / 2
    keep = counts >= min_count
    return HistoryTable(uniq[keep], med[keep].astype(np.float32))


def merge_tables(tables: Sequence[HistoryTable]) -> HistoryTable:
    """Union of tables over disjoint key sets."""
    keys = np.concatenate([t.keys for t in tables])
    values = np.concatenate([t.values for t in tables])
    order = np.argsort(keys)
    return HistoryTable(keys[order], values[order])


@dataclass
class History:
    tables: tuple[HistoryTable, HistoryTable, HistoryTable]

    @classmethod
    def fit(cls, ex: Examples) -> "History":
        if ex.target_s is None:
            raise ValueError("History needs targets")
        change = ex.target_s - ex.cols["delay_s"]
        keys = history_keys(ex)
        return cls(
            tuple(  # type: ignore[arg-type]
                median_table(k, change, m)
                for k, m in zip(keys, HISTORY_MIN_COUNT, strict=True)
            )
        )

    def predict(self, ex: Examples) -> tuple[FloatArray, FloatArray]:
        """Median delay change and the level it came from (1-3; 4 = none)."""
        value = np.zeros(len(ex))
        level = np.full(len(ex), 4.0)
        for lvl, (table, q) in enumerate(
            zip(self.tables, history_keys(ex), strict=True), start=1
        ):
            v, found = table.lookup(q)
            take = found & (level == 4)
            value[take] = v[take]
            level[take] = lvl
        return value, level

    def to_arrays(self) -> dict[str, np.ndarray]:
        out: dict[str, np.ndarray] = {}
        for i, t in enumerate(self.tables, start=1):
            out[f"hist{i}_keys"] = t.keys
            out[f"hist{i}_values"] = t.values
        return out

    @classmethod
    def from_arrays(cls, a: dict[str, np.ndarray]) -> "History":
        return cls(
            tuple(  # type: ignore[arg-type]
                HistoryTable(
                    a[f"hist{i}_keys"].astype(np.uint64),
                    a[f"hist{i}_values"].astype(np.float32),
                )
                for i in (1, 2, 3)
            )
        )


def feature_matrix(
    ex: Examples,
    history_s: FloatArray,
    history_level: FloatArray,
    out: np.ndarray | None = None,
) -> FloatArray:
    """Model inputs in FEATURES order; fills `out` (rows x features) if given."""
    c = ex.cols
    derived = {
        "otp_minus_delay_s": lambda: c["otp_delay_s"] - c["delay_s"],
        "stops_ahead": lambda: c["target_seq"] - c["origin_seq"],
        "history_s": lambda: history_s,
        "history_level": lambda: history_level,
    }
    if out is None:
        out = np.empty((len(ex), len(FEATURES)), dtype=np.float64)
    for i, f in enumerate(FEATURES):
        out[:, i] = derived[f]() if f in derived else c[f]
    return out
