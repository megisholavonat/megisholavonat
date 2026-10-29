"""
Delay forecast CLI (run from apps/api, or /app in the image).

    # train on the last 28 days up to yesterday and store the model (needs
    # LightGBM: the trainer image, or `uv sync --group train`)
    python -m api.forecast train
    # fixed window and holdout, print metrics without storing
    python -m api.forecast train --end 2026-09-09 --holdout-from 2026-09-01 --dry-run
    # inference timing and memory on recorded snapshots with the latest model
    python -m api.forecast bench --replay vehicles-2026-09-08.jsonl.gz
"""

import argparse
import asyncio
import json
import resource
import time
from datetime import date
from typing import Any

from api.core.db import SessionLocal, engine
from api.core.logging_config import setup_logging
from api.forecast.train import TrainConfig


async def _train(args: argparse.Namespace) -> None:
    from api.forecast.train import save_model, train, training_engine

    cfg = TrainConfig(
        days=args.days,
        holdout_days=args.holdout_days,
        max_rows=args.rows,
        n_trees=args.trees,
        max_depth=args.max_depth,
        num_leaves=args.leaves,
        num_threads=args.threads,
    )
    end = date.fromisoformat(args.end) if args.end else None
    holdout_from = date.fromisoformat(args.holdout_from) if args.holdout_from else None
    read_engine = training_engine()
    try:
        async with read_engine.connect() as conn:
            result = await train(conn, end, cfg, holdout_from)
    finally:
        await read_engine.dispose()
    out: dict[str, Any] = dict(result.metrics)
    out["artifact_bytes"] = len(result.model.to_bytes())
    out["peak_rss_mib"] = round(_peak_rss_mib())
    if not args.dry_run:
        async with SessionLocal() as session:
            out["model_id"] = await save_model(session, result)
    print(json.dumps(out, indent=2))


def _peak_rss_mib() -> float:
    # ru_maxrss is KiB on Linux
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


async def _bench(args: argparse.Namespace) -> None:
    from api.forecast.serve import annotate_locations, model_cache
    from api.services.train_service import TrainService
    from api.util.replay import iter_snapshots

    rss_start = _peak_rss_mib()
    model = await model_cache.get()
    print(f"model {model_cache.model_id} loaded, peak RSS {_peak_rss_mib():.0f} MiB")
    service = TrainService(None)  # type: ignore[arg-type]
    timings = []
    for n, snapshot in enumerate(iter_snapshots(args.replay)):
        if n < args.skip:
            continue
        service.reference_time = snapshot.get("fetched_at_unix")
        locations = service.dedupe_by_vehicle_id(snapshot.get("vehicles") or [])
        processed = service.process_locations(locations)
        start = time.perf_counter()
        annotated = annotate_locations(processed, model)
        elapsed = time.perf_counter() - start
        timings.append(elapsed)
        print(
            f"snapshot {n}: {len(processed)} vehicles, {annotated} stops "
            f"predicted in {1000 * elapsed:.1f} ms"
        )
        if len(timings) >= args.snapshots:
            break
    print(
        f"peak RSS {_peak_rss_mib():.0f} MiB (at start {rss_start:.0f} MiB); "
        f"median {1000 * sorted(timings)[len(timings) // 2]:.1f} ms"
    )


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m api.forecast")
    sub = parser.add_subparsers(dest="command", required=True)

    t = sub.add_parser("train", help="train, evaluate and store a model")
    t.add_argument("--end", help="last service date (default: yesterday)")
    t.add_argument("--days", type=int, default=28)
    t.add_argument("--holdout-days", type=int, default=7)
    t.add_argument("--holdout-from", help="first holdout date (overrides days)")
    t.add_argument("--rows", type=int, default=TrainConfig.max_rows)
    t.add_argument("--trees", type=int, default=TrainConfig.n_trees)
    t.add_argument("--leaves", type=int, default=TrainConfig.num_leaves)
    t.add_argument("--threads", type=int, default=TrainConfig.num_threads)
    t.add_argument("--max-depth", type=int, default=TrainConfig.max_depth)
    t.add_argument("--dry-run", action="store_true", help="do not store")

    b = sub.add_parser("bench", help="time inference on recorded snapshots")
    b.add_argument("--replay", required=True, help="vehicles-*.jsonl(.gz) file")
    b.add_argument("--snapshots", type=int, default=5)
    b.add_argument("--skip", type=int, default=0, help="snapshots to skip first")

    args = parser.parse_args()
    setup_logging()

    async def run() -> None:
        try:
            await (_train(args) if args.command == "train" else _bench(args))
        finally:
            await engine.dispose()

    asyncio.run(run())


if __name__ == "__main__":
    main()
