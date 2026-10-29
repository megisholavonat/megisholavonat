"""The numpy evaluator for LightGBM JSON dumps (api.forecast.trees)."""

import json
from typing import Any

import numpy as np
import pytest

from api.forecast.trees import TreeEnsemble


def _split(
    feature: int,
    threshold: float,
    left: dict[str, Any],
    right: dict[str, Any],
    missing: str = "None",
    default_left: bool = True,
) -> dict[str, Any]:
    return {
        "split_feature": feature,
        "threshold": threshold,
        "decision_type": "<=",
        "default_left": default_left,
        "missing_type": missing,
        "left_child": left,
        "right_child": right,
    }


def _leaf(v: float) -> dict[str, Any]:
    return {"leaf_value": v}


def _dump(*trees: dict[str, Any], objective: str = "regression_l1") -> dict[str, Any]:
    return {
        "objective": objective,
        "num_tree_per_iteration": 1,
        "max_feature_idx": 1,
        "tree_info": [{"tree_structure": t} for t in trees],
    }


def test_numeric_splits_and_missing_values() -> None:
    nan_split = _split(0, 1.0, _leaf(1), _leaf(2), missing="NaN", default_left=False)
    zero_split = _split(1, -5.0, _leaf(10), _leaf(20), missing="Zero")
    plain = _split(1, -5.0, _leaf(100), _leaf(200))
    ens = TreeEnsemble.from_dump(_dump(nan_split, zero_split, plain, _leaf(0.5)))
    X = np.array(
        [
            [0.5, 0.0],  # left; zero is missing -> default left; 0 > -5 right
            [np.nan, np.nan],  # default right; NaN reads as 0 -> missing -> left
            [3.0, -9.0],  # right; left; left
        ]
    )

    np.testing.assert_array_equal(
        ens.predict(X), [1 + 10 + 200.5, 2 + 10 + 200.5, 2 + 10 + 100.5]
    )
    assert ens.n_trees == 4
    assert ens.depth == 1


def test_rejects_what_it_cannot_evaluate() -> None:
    cat = _split(0, 1.0, _leaf(1), _leaf(2)) | {"decision_type": "=="}
    with pytest.raises(ValueError, match="Categorical"):
        TreeEnsemble.from_dump(_dump(cat))
    with pytest.raises(ValueError, match="objective"):
        TreeEnsemble.from_dump(_dump(_leaf(1), objective="binary sigmoid:1"))
    with pytest.raises(ValueError, match="features"):
        TreeEnsemble.from_dump(_dump(_leaf(1))).predict(np.zeros((2, 1)))


def test_matches_lightgbm_predict() -> None:
    """Parity with LightGBM itself (installed with the dev and train groups)."""
    lgb = pytest.importorskip("lightgbm")
    rng = np.random.default_rng(0)
    n = 20_000
    X = rng.normal(size=(n, 6)) * [1, 10, 100, 1, 1, 1000]
    X[:, 3] = rng.integers(0, 10, n)  # small integers, like product codes
    X[rng.random(n) < 0.1, 1] = np.nan  # NaN-type splits
    X[rng.random(n) < 0.3, 4] = 0.0  # many exact zeros
    y = (
        3 * X[:, 0]
        + np.where(np.isnan(X[:, 1]), 50, np.nan_to_num(X[:, 1]))
        + 0.1 * X[:, 2]
        + 7 * X[:, 3]
        + rng.normal(0, 5, n)
    )
    params = {
        "objective": "l1",
        "num_leaves": 63,
        "max_depth": 10,
        "min_data_in_leaf": 20,
        "learning_rate": 0.1,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "verbose": -1,
        "num_threads": 1,
    }
    booster = lgb.train(params, lgb.Dataset(X, y), num_boost_round=50)
    # Through the stored form: dump -> arrays -> what a worker loads
    stored = TreeEnsemble.from_dump(json.loads(json.dumps(booster.dump_model())))
    ens = TreeEnsemble.from_arrays(stored.to_arrays())

    X_test = rng.normal(size=(5000, 6)) * [1, 10, 100, 1, 1, 1000]
    X_test[:, 3] = rng.integers(-1, 12, 5000)
    X_test[rng.random(5000) < 0.2, :] = np.nan
    X_test[rng.random(5000) < 0.2, 4] = 0.0

    np.testing.assert_allclose(
        ens.predict(X_test), booster.predict(X_test), rtol=0, atol=1e-6
    )


def test_arrays_roundtrip_and_validation() -> None:
    tree = _split(0, 1.0, _leaf(1), _split(1, 2.0, _leaf(2), _leaf(3), missing="NaN"))
    ens = TreeEnsemble.from_dump(_dump(tree, _leaf(0.5)))
    X = np.array([[0.0, 0.0], [2.0, np.nan], [2.0, 5.0]])

    again = TreeEnsemble.from_arrays(ens.to_arrays())

    np.testing.assert_array_equal(again.predict(X), ens.predict(X))
    assert (again.depth, again.n_features) == (2, 2)
    broken = ens.to_arrays()
    broken["tree_left"] = broken["tree_left"] + 100
    with pytest.raises(ValueError, match="Inconsistent"):
        TreeEnsemble.from_arrays(broken)
