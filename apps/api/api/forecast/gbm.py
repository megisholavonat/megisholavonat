"""
Gradient-boosted oblivious decision trees in plain numpy, with an L1 objective.

The API image is musl-based and none of LightGBM, XGBoost, CatBoost or
scikit-learn publish musllinux wheels, so the model is trained and evaluated
with numpy alone. Oblivious (symmetric) trees, as in CatBoost, use the same
split at every node of a level, so a tree of depth D is D (feature, bin)
pairs plus 2**D leaf values. Both training (one histogram pass per feature and
level) and inference (D comparisons per tree, vectorised over rows and trees)
are cheap without a compiled library.

Features are bucketed once into at most 255 quantile bins; bin 0 holds missing
values, so NaN is a first-class value and inference works on the same bins.
L1 boosting fits each tree to the sign of the residuals and sets every leaf to
the median residual of its rows (like LightGBM's `l1` objective).
"""

from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

FloatArray = npt.NDArray[np.float64]
# Inputs may be float32 (training keeps its matrix compact)
InputArray = npt.NDArray[np.floating]
BinArray = npt.NDArray[np.uint8]

MAX_BINS = 255  # bin 0 is "missing", so at most 254 finite borders


@dataclass
class Binner:
    """Per-feature quantile borders; bin 0 is NaN, finite values get 1..k+1."""

    borders: list[FloatArray]

    @classmethod
    def fit(cls, X: InputArray, max_bins: int = 128) -> "Binner":
        if not 2 <= max_bins <= MAX_BINS:
            raise ValueError("max_bins must be within 2..255")
        borders = []
        qs = np.linspace(0, 1, max_bins)[1:-1]
        for f in range(X.shape[1]):
            col = X[:, f]
            col = col[~np.isnan(col)]
            if col.size == 0:
                borders.append(np.empty(0))
                continue
            uniq = np.unique(col)
            if uniq.size <= max_bins - 1:
                # Few distinct values: split between each consecutive pair
                b = (uniq[:-1] + uniq[1:]) / 2
            else:
                b = np.unique(np.quantile(col, qs))
            borders.append(b.astype(np.float64))
        return cls(borders)

    def transform(self, X: InputArray) -> BinArray:
        out = np.zeros(X.shape, dtype=np.uint8)
        for f, b in enumerate(self.borders):
            col = X[:, f]
            bins = np.searchsorted(b, col, side="left") + 1
            bins[np.isnan(col)] = 0
            out[:, f] = bins
        return out


@dataclass
class ObliviousGBM:
    binner: Binner
    base: float
    # (n_trees, depth): feature index and bin threshold (go right if bin > thr)
    features: npt.NDArray[np.int16]
    thresholds: npt.NDArray[np.uint8]
    # (n_trees, 2**depth)
    leaves: npt.NDArray[np.float32]

    @property
    def n_trees(self) -> int:
        return int(self.leaves.shape[0])

    @property
    def depth(self) -> int:
        return int(self.features.shape[1])

    def predict(self, X: InputArray, chunk_rows: int = 5_000) -> FloatArray:
        return self.predict_binned(self.binner.transform(X), chunk_rows)

    def predict_binned(self, Xb: BinArray, chunk_rows: int = 5_000) -> FloatArray:
        """Sum of leaf values. Rows go in chunks, so the (rows, trees, depth)
        intermediate stays around chunk_rows * n_trees * depth bytes."""
        n = Xb.shape[0]
        out = np.full(n, self.base, dtype=np.float64)
        if n == 0 or self.n_trees == 0:
            return out
        trees = np.arange(self.n_trees)
        for r0 in range(0, n, chunk_rows):
            xb = Xb[r0 : r0 + chunk_rows]
            go_right = xb[:, self.features] > self.thresholds  # (m, trees, depth)
            # Bit `level` of the leaf index is the decision at that level
            idx = np.packbits(go_right, axis=-1, bitorder="little")[..., 0]
            out[r0 : r0 + xb.shape[0]] += self.leaves[trees, idx].sum(
                1, dtype=np.float64
            )
        return out

    def leaf_index(self, Xb: BinArray, tree: int) -> npt.NDArray[np.int64]:
        idx = np.zeros(Xb.shape[0], dtype=np.int64)
        for level in range(self.depth):
            f, thr = self.features[tree, level], self.thresholds[tree, level]
            idx |= (Xb[:, f] > thr).astype(np.int64) << level
        return idx

    # --- serialisation (plain arrays, no pickle) ---

    def to_arrays(self, prefix: str = "gbm_") -> dict[str, np.ndarray]:
        lengths = np.array([b.size for b in self.binner.borders], dtype=np.int64)
        flat = (
            np.concatenate(self.binner.borders)
            if self.binner.borders
            else np.empty(0, dtype=np.float64)
        )
        return {
            f"{prefix}base": np.array([self.base]),
            f"{prefix}features": self.features,
            f"{prefix}thresholds": self.thresholds,
            f"{prefix}leaves": self.leaves,
            f"{prefix}border_lengths": lengths,
            f"{prefix}borders": flat,
        }

    @classmethod
    def from_arrays(cls, a: Any, prefix: str = "gbm_") -> "ObliviousGBM":
        lengths = a[f"{prefix}border_lengths"]
        flat = a[f"{prefix}borders"].astype(np.float64)
        splits = np.cumsum(lengths)[:-1]
        borders = list(np.split(flat, splits)) if len(lengths) else []
        return cls(
            binner=Binner(borders),
            base=float(a[f"{prefix}base"][0]),
            features=a[f"{prefix}features"].astype(np.int16),
            thresholds=a[f"{prefix}thresholds"].astype(np.uint8),
            leaves=a[f"{prefix}leaves"].astype(np.float32),
        )


def _group_medians(
    groups: npt.NDArray[np.int64], values: FloatArray, n_groups: int
) -> tuple[FloatArray, npt.NDArray[np.int64]]:
    """Median and count of `values` per group id in [0, n_groups)."""
    order = np.lexsort((values, groups))
    v = values[order]
    counts = np.bincount(groups, minlength=n_groups)
    starts = np.concatenate(([0], np.cumsum(counts)[:-1]))
    med = np.zeros(n_groups)
    has = counts > 0
    lo = starts[has] + (counts[has] - 1) // 2
    hi = starts[has] + counts[has] // 2
    med[has] = (v[lo] + v[hi]) / 2
    return med, counts


def fit(
    X: InputArray,
    y: FloatArray,
    *,
    n_trees: int = 300,
    depth: int = 6,
    learning_rate: float = 0.1,
    l2: float = 10.0,
    subsample: float = 0.5,
    max_bins: int = 128,
    seed: int = 0,
    binner: Binner | None = None,
) -> ObliviousGBM:
    """Fit an L1 gradient-boosted ensemble of oblivious trees."""
    if not 1 <= depth <= 8:
        raise ValueError("depth must be within 1..8")
    rng = np.random.default_rng(seed)
    binner = binner or Binner.fit(X, max_bins)
    Xb = binner.transform(X)
    n, n_features = Xb.shape
    nb = int(Xb.max()) + 1 if n else 1
    n_leaves = 1 << depth

    base = float(np.median(y)) if n else 0.0
    pred = np.full(n, base)
    features = np.zeros((n_trees, depth), dtype=np.int16)
    thresholds = np.zeros((n_trees, depth), dtype=np.uint8)
    leaves = np.zeros((n_trees, n_leaves), dtype=np.float32)
    model = ObliviousGBM(binner, base, features, thresholds, leaves)
    if n == 0:
        return model

    for t in range(n_trees):
        residual = y - pred
        rows = np.flatnonzero(rng.random(n) < subsample) if subsample < 1 else None
        Xs = Xb if rows is None else Xb[rows]
        g = np.sign(residual if rows is None else residual[rows])
        leaf = np.zeros(Xs.shape[0], dtype=np.int64)
        for level in range(depth):
            size = (1 << level) * nb
            best_gain, best_f, best_b = -np.inf, 0, 0
            for f in range(n_features):
                key = leaf * nb + Xs[:, f]
                G = np.bincount(key, weights=g, minlength=size).reshape(-1, nb)
                N = np.bincount(key, minlength=size).reshape(-1, nb).astype(np.float64)
                GL, NL = np.cumsum(G, 1)[:, :-1], np.cumsum(N, 1)[:, :-1]
                GR, NR = G.sum(1, keepdims=True) - GL, N.sum(1, keepdims=True) - NL
                gain = (GL**2 / (NL + l2) + GR**2 / (NR + l2)).sum(0)
                b = int(np.argmax(gain))
                if gain[b] > best_gain:
                    best_gain, best_f, best_b = float(gain[b]), f, b
            features[t, level], thresholds[t, level] = best_f, best_b
            leaf |= (Xs[:, best_f] > best_b).astype(np.int64) << level

        # Leaf values: shrunken median residual over all rows in the leaf
        idx = model.leaf_index(Xb, t)
        med, counts = _group_medians(idx, residual, n_leaves)
        values = learning_rate * med * counts / (counts + l2)
        leaves[t] = values
        pred += values[idx]

    return model
