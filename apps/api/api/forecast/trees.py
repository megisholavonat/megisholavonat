"""
Numpy evaluator for a LightGBM model exported with `Booster.dump_model()`.

The trainer runs LightGBM in its own image and converts the dump into these
arrays (`from_dump`); the stored artifact holds only the arrays
(`to_arrays`), so the API never parses the JSON.
Every tree is flattened into one table of nodes. Leaves point to themselves,
so all (row, tree) pairs can step down together for `depth` iterations and
then read their leaf value. Splits follow LightGBM's NumericalDecision: NaN
counts as 0 unless the split has missing_type "NaN", missing values (NaN, or
zero for missing_type "Zero") take the default side, otherwise go left when
value <= threshold.
"""

from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

FloatArray = npt.NDArray[np.float64]
IntArray = npt.NDArray[np.int32]

# LightGBM's kZeroThreshold
ZERO_THRESHOLD = 1e-35
MISSING_TYPES = {"None": 0, "Zero": 1, "NaN": 2}
# Objectives whose raw score is the prediction (no link function)
IDENTITY_OBJECTIVES = ("regression", "regression_l1", "huber", "fair", "quantile")


@dataclass
class TreeEnsemble:
    roots: IntArray  # node index of each tree's root
    feature: IntArray
    threshold: FloatArray  # +inf on leaves
    missing: npt.NDArray[np.int8]
    default_left: npt.NDArray[np.bool_]
    left: IntArray  # leaves point to themselves
    right: IntArray
    value: FloatArray  # leaf value, 0 on splits
    depth: int
    n_features: int

    @property
    def n_trees(self) -> int:
        return int(self.roots.size)

    @classmethod
    def from_dump(cls, dump: dict[str, Any]) -> "TreeEnsemble":
        objective = str(dump.get("objective", "")).split(" ")[0]
        if objective not in IDENTITY_OBJECTIVES:
            raise ValueError(f"Unsupported objective {objective!r}")
        if dump.get("num_tree_per_iteration", 1) != 1 or dump.get("average_output"):
            raise ValueError("Only single-output boosted models are supported")

        feature: list[int] = []
        threshold: list[float] = []
        missing: list[int] = []
        default_left: list[bool] = []
        left: list[int] = []
        right: list[int] = []
        value: list[float] = []
        roots: list[int] = []
        depth = 0

        def add(node: dict[str, Any], level: int) -> int:
            nonlocal depth
            i = len(feature)
            feature.append(0)
            threshold.append(np.inf)
            missing.append(0)
            default_left.append(True)
            left.append(i)
            right.append(i)
            value.append(0.0)
            if "leaf_value" in node:
                value[i] = float(node["leaf_value"])
                depth = max(depth, level)
                return i
            if node.get("decision_type", "<=") != "<=":
                raise ValueError("Categorical splits are not supported")
            feature[i] = int(node["split_feature"])
            threshold[i] = float(node["threshold"])
            missing[i] = MISSING_TYPES[node.get("missing_type", "None")]
            default_left[i] = bool(node.get("default_left", True))
            left[i] = add(node["left_child"], level + 1)
            right[i] = add(node["right_child"], level + 1)
            return i

        for tree in dump["tree_info"]:
            roots.append(add(tree["tree_structure"], 0))

        return cls(
            roots=np.array(roots, dtype=np.int32),
            feature=np.array(feature, dtype=np.int32),
            threshold=np.array(threshold, dtype=np.float64),
            missing=np.array(missing, dtype=np.int8),
            default_left=np.array(default_left, dtype=bool),
            left=np.array(left, dtype=np.int32),
            right=np.array(right, dtype=np.int32),
            value=np.array(value, dtype=np.float64),
            depth=depth,
            n_features=int(dump.get("max_feature_idx", -1)) + 1,
        )

    def to_arrays(self, prefix: str = "tree_") -> dict[str, np.ndarray]:
        return {
            f"{prefix}roots": self.roots,
            f"{prefix}feature": self.feature,
            f"{prefix}threshold": self.threshold,
            f"{prefix}missing": self.missing,
            f"{prefix}default_left": self.default_left,
            f"{prefix}left": self.left,
            f"{prefix}right": self.right,
            f"{prefix}value": self.value,
            f"{prefix}shape": np.array([self.depth, self.n_features], dtype=np.int64),
        }

    @classmethod
    def from_arrays(
        cls, a: dict[str, np.ndarray], prefix: str = "tree_"
    ) -> "TreeEnsemble":
        """Rebuild from `to_arrays`, checking every index stays in bounds."""
        depth, n_features = (int(v) for v in a[f"{prefix}shape"])
        ens = cls(
            roots=a[f"{prefix}roots"].astype(np.int32),
            feature=a[f"{prefix}feature"].astype(np.int32),
            threshold=a[f"{prefix}threshold"].astype(np.float64),
            missing=a[f"{prefix}missing"].astype(np.int8),
            default_left=a[f"{prefix}default_left"].astype(bool),
            left=a[f"{prefix}left"].astype(np.int32),
            right=a[f"{prefix}right"].astype(np.int32),
            value=a[f"{prefix}value"].astype(np.float64),
            depth=depth,
            n_features=n_features,
        )
        n = ens.feature.size
        per_node = (
            ens.threshold,
            ens.missing,
            ens.default_left,
            ens.left,
            ens.right,
            ens.value,
        )
        if (
            any(v.size != n for v in per_node)
            or not np.all((ens.roots >= 0) & (ens.roots < n))
            or not np.all((ens.left >= 0) & (ens.left < n))
            or not np.all((ens.right >= 0) & (ens.right < n))
            or not np.all((ens.feature >= 0) & (ens.feature < max(n_features, 1)))
            or not np.isin(ens.missing, (0, 1, 2)).all()
            or depth < 0
        ):
            raise ValueError("Inconsistent tree arrays")
        return ens

    def predict(
        self, X: npt.NDArray[np.floating], chunk_rows: int = 2_000
    ) -> FloatArray:
        X64: FloatArray = np.ascontiguousarray(X, dtype=np.float64)
        if X64.ndim != 2 or X64.shape[1] < self.n_features:
            raise ValueError(f"Expected {self.n_features} features, got {X64.shape}")
        out = np.zeros(X64.shape[0])
        for r0 in range(0, X64.shape[0], chunk_rows):
            out[r0 : r0 + chunk_rows] = self._predict(X64[r0 : r0 + chunk_rows])
        return out

    def __post_init__(self) -> None:
        # Where NaN goes at each node: the default side for "NaN" splits,
        # otherwise NaN reads as 0 (the default side if 0 counts as missing)
        zero_left = np.where(
            self.missing == 1, self.default_left, self.threshold >= 0.0
        )
        self._nan_left = np.where(self.missing == 2, self.default_left, zero_left)
        self._zero_nodes = bool((self.missing == 1).any())
        # children[2 * node + go_right]
        self._children = (
            np.stack([self.left, self.right], axis=1).ravel().astype(np.intp)
        )
        # Native index width, so take() does not convert on every step
        self._feature = self.feature.astype(np.intp)

    def _predict(self, X: FloatArray) -> FloatArray:
        # Buffers are allocated once per chunk and reused at every level:
        # musl's allocator maps fresh pages for each large temporary, which
        # made the allocating version ~3x slower in the Alpine image
        n, n_cols = X.shape
        shape = (n, self.n_trees)
        flat = X.ravel()
        row_base = (np.arange(n, dtype=np.intp) * n_cols)[:, None]
        node = np.empty(shape, dtype=np.intp)
        node[:] = self.roots
        idx = np.empty(shape, dtype=np.intp)
        x = np.empty(shape)
        thr = np.empty(shape)
        go_right = np.empty(shape, dtype=bool)
        nan = np.empty(shape, dtype=bool)
        for _ in range(self.depth):
            np.take(self._feature, node, out=idx)
            idx += row_base
            np.take(flat, idx, out=x)
            np.take(self.threshold, node, out=thr)
            np.greater(x, thr, out=go_right)
            np.isnan(x, out=nan)
            if nan.any():
                go_right[nan] = ~self._nan_left[node[nan]]
            if self._zero_nodes:
                zero = (np.abs(x) <= ZERO_THRESHOLD) & (self.missing.take(node) == 1)
                go_right[zero] = ~self.default_left[node[zero]]
            np.multiply(node, 2, out=idx)
            idx += go_right
            np.take(self._children, idx, out=node)
        np.take(self.value, node, out=x)
        leaves: FloatArray = x.sum(axis=1)
        return leaves
