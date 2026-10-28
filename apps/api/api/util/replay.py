"""
Replay of recorded vehicle snapshots for local development and tests.

A snapshot file holds one JSON object per line
(`{fetched_at, fetched_at_unix, ok, vehicle_count, vehicles: [...]}`) and may be
gzip-compressed. Real files are ~850 MB per day, so they are only ever streamed.
"""

import asyncio
import gzip
from collections.abc import Iterator
from pathlib import Path
from typing import IO, Any, cast

import orjson
from redis.asyncio import Redis

from api.core.logging_config import get_logger
from api.core.redis import add_key

logger = get_logger(__name__)


def open_snapshot_file(path: str | Path) -> IO[bytes]:
    path = Path(path)
    if path.suffix == ".gz":
        return cast(IO[bytes], gzip.open(path, "rb"))
    return path.open("rb")


def iter_snapshots(path: str | Path) -> Iterator[dict[str, Any]]:
    """Stream every snapshot in a file, one line at a time."""
    with open_snapshot_file(path) as f:
        for line in f:
            if line.strip():
                yield orjson.loads(line)


class _Reader:
    """
    Sequential reader that can jump to line N. Moving forward only reads the
    lines in between; moving backward reopens the file.
    """

    def __init__(self, path: str) -> None:
        self.path = path
        self._file: IO[bytes] | None = None
        self._pos = 0  # index of the next line to be read
        self.total: int | None = None  # number of lines, once EOF was seen

    def _reopen(self) -> None:
        if self._file:
            self._file.close()
        self._file = open_snapshot_file(self.path)
        self._pos = 0

    def read(self, index: int) -> bytes | None:
        if self._file is None or index < self._pos:
            self._reopen()
        assert self._file is not None
        while True:
            line = self._file.readline()
            if not line:
                self.total = self._pos
                return None
            self._pos += 1
            if self._pos - 1 == index:
                return line


# One reader per process and file; the cursor itself lives in Redis so that
# several worker processes advance through the same sequence.
_readers: dict[str, _Reader] = {}


async def next_snapshot(redis: Redis, path: str) -> dict[str, Any]:
    """Return the next snapshot from `path`, looping when the file ends."""
    reader = _readers.get(path)
    if reader is None:
        reader = _readers[path] = _Reader(path)

    cursor = int(await redis.incr(add_key("replay-cursor"))) - 1
    if reader.total:
        cursor %= reader.total

    line = await asyncio.to_thread(reader.read, cursor)
    if line is None:
        if not reader.total:
            raise ValueError(f"Replay file {path} contains no snapshots")
        logger.info(f"Replay file exhausted after {reader.total} snapshots, looping")
        cursor %= reader.total
        line = await asyncio.to_thread(reader.read, cursor)
        assert line is not None

    snapshot: dict[str, Any] = orjson.loads(line)
    logger.info(
        f"Replaying snapshot #{cursor} from {snapshot.get('fetched_at')} "
        f"({snapshot.get('vehicle_count')} vehicles)"
    )
    return snapshot
