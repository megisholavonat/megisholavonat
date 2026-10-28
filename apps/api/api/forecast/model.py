"""
The served forecast: c1 history tables plus the boosted trees, with the
fallback chain model -> history (c1) -> constant delay, and (de)serialisation
to a single npz blob without pickle.
"""

import io
import json
from dataclasses import dataclass
from enum import IntEnum
from typing import Any

import numpy as np

from api.core.logging_config import get_logger
from api.forecast.features import (
    FEATURES,
    Examples,
    FloatArray,
    History,
    feature_matrix,
)
from api.forecast.gbm import ObliviousGBM

logger = get_logger(__name__)

# Bump when the artifact layout or FEATURES change
FORMAT_VERSION = 1


class Source(IntEnum):
    CONSTANT = 0
    HISTORY = 1
    MODEL = 2


# Predicted changes beyond this are treated as model failures
MAX_ABS_CHANGE_S = 3 * 3600


@dataclass
class ForecastModel:
    history: History
    gbm: ObliviousGBM | None
    features: tuple[str, ...] = FEATURES

    def predict(
        self, ex: Examples
    ) -> tuple[FloatArray, np.ndarray[Any, np.dtype[np.int8]]]:
        """Predicted delay (seconds) at each example's target stop and its source."""
        delay = ex.cols["delay_s"]
        pred = delay.copy()
        source = np.full(len(ex), Source.CONSTANT, dtype=np.int8)
        if len(ex) == 0:
            return pred, source
        try:
            hist, level = self.history.predict(ex)
        except Exception as e:
            logger.error(f"Forecast: history lookup failed: {e}")
            return pred, source
        found = level < 4
        pred[found] = delay[found] + hist[found]
        source[found] = Source.HISTORY

        if self.gbm is None:
            return pred, source
        try:
            change = self.gbm.predict(feature_matrix(ex, hist, level))
        except Exception as e:
            logger.error(f"Forecast: model inference failed: {e}")
            return pred, source
        ok = np.isfinite(change) & (np.abs(change) <= MAX_ABS_CHANGE_S)
        pred[ok] = delay[ok] + change[ok]
        source[ok] = Source.MODEL
        return pred, source

    def to_bytes(self) -> bytes:
        arrays: dict[str, np.ndarray] = dict(self.history.to_arrays())
        if self.gbm is not None:
            arrays.update(self.gbm.to_arrays())
        meta = {"format_version": FORMAT_VERSION, "features": list(self.features)}
        arrays["meta"] = np.frombuffer(json.dumps(meta).encode(), dtype=np.uint8)
        buf = io.BytesIO()
        np.savez_compressed(buf, **arrays)  # type: ignore[arg-type]
        return buf.getvalue()

    @classmethod
    def from_bytes(cls, blob: bytes) -> "ForecastModel":
        with np.load(io.BytesIO(blob), allow_pickle=False) as npz:
            a = {k: npz[k] for k in npz.files}
        meta = json.loads(a["meta"].tobytes().decode())
        if meta.get("format_version") != FORMAT_VERSION:
            raise ValueError(
                f"Unsupported forecast format {meta.get('format_version')}"
            )
        features = tuple(meta["features"])
        if features != FEATURES:
            raise ValueError("Forecast artifact was trained on other features")
        gbm = ObliviousGBM.from_arrays(a) if "gbm_leaves" in a else None
        return cls(History.from_arrays(a), gbm, features)
