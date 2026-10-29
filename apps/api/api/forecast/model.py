"""
The served forecast: c1 history tables plus the boosted trees, with the
fallback chain model -> history (c1) -> constant delay.

The artifact is one npz (no pickle) holding the history tables, the
LightGBM model as its `dump_model()` JSON, and the format version and feature
list it was trained with.
"""

import io
import json
from dataclasses import dataclass, field
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
from api.forecast.trees import TreeEnsemble

logger = get_logger(__name__)

# Bump when the artifact layout or FEATURES change. 1 was the numpy-trained
# oblivious trees; 2 is a LightGBM JSON dump
FORMAT_VERSION = 2


class Source(IntEnum):
    CONSTANT = 0
    HISTORY = 1
    MODEL = 2


# Predicted changes beyond this are treated as model failures
MAX_ABS_CHANGE_S = 3 * 3600


@dataclass
class ForecastModel:
    history: History
    # LightGBM `dump_model()` output as JSON text, None for history only
    model_json: str | None = None
    features: tuple[str, ...] = FEATURES
    trees: TreeEnsemble | None = field(init=False, default=None)

    def __post_init__(self) -> None:
        self.trees = (
            None
            if self.model_json is None
            else TreeEnsemble.from_dump(json.loads(self.model_json))
        )

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

        if self.trees is None:
            return pred, source
        try:
            change = self.trees.predict(feature_matrix(ex, hist, level))
        except Exception as e:
            logger.error(f"Forecast: model inference failed: {e}")
            return pred, source
        ok = np.isfinite(change) & (np.abs(change) <= MAX_ABS_CHANGE_S)
        pred[ok] = delay[ok] + change[ok]
        source[ok] = Source.MODEL
        return pred, source

    def to_bytes(self) -> bytes:
        arrays: dict[str, np.ndarray] = dict(self.history.to_arrays())
        if self.model_json is not None:
            arrays["model_json"] = np.frombuffer(
                self.model_json.encode(), dtype=np.uint8
            )
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
        model_json = a["model_json"].tobytes().decode() if "model_json" in a else None
        return cls(History.from_arrays(a), model_json, features)
