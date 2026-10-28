"""
Shared fixtures.

Tests need a running Postgres. By default they use the `DATABASE_URL` server
with the database name suffixed by `_test`, recreated at the start of every
session so switching branches never leaves stale migrations behind; set
`TEST_DATABASE_URL` to point somewhere else (that database is only created if
missing, never dropped). Migrations run once per session.

Upstream is never called: `REPLAY_FILE` points at the committed fixture, the
`otp` fixture mocks the GraphQL endpoint, and Redis is replaced by fakeredis.
"""

import os
from collections.abc import AsyncGenerator, Iterator
from pathlib import Path

import asyncpg  # type: ignore[import-untyped]
import pytest
from sqlalchemy.engine import make_url

from api.core.config import settings

FIXTURES = Path(__file__).parent / "fixtures"
REPLAY_FIXTURE = FIXTURES / "vehicles-sample.jsonl.gz"

# Settings must be adjusted before anything imports the engine or broker
_test_url = make_url(
    os.environ.get("TEST_DATABASE_URL") or settings.DATABASE_URL.replace("+asyncpg", "")
)
if "TEST_DATABASE_URL" not in os.environ:
    _test_url = _test_url.set(database=f"{_test_url.database}_test")
_test_url = _test_url.set(drivername="postgresql+asyncpg")
settings.DATABASE_URL = _test_url.render_as_string(hide_password=False)
settings.REPLAY_FILE = str(REPLAY_FIXTURE)
settings.REDIS_KEY = "mhav-test"
# Tests must not depend on a developer's .env
settings.TRUSTED_PROXIES = ""

import fakeredis  # noqa: E402
import httpx  # noqa: E402
import respx  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)
from sqlalchemy.pool import NullPool  # noqa: E402

from api.core.db import get_session  # noqa: E402
from api.core.redis import get_redis  # noqa: E402
from api.main import create_app  # noqa: E402
from api.services import station_index  # noqa: E402
from api.util import replay  # noqa: E402

API_DIR = Path(__file__).parent.parent


async def _ensure_database() -> None:
    url = _test_url.set(drivername="postgresql")
    conn = await asyncpg.connect(
        url.set(database="postgres").render_as_string(hide_password=False)
    )
    try:
        if "TEST_DATABASE_URL" not in os.environ:
            await conn.execute(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)')
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", url.database
        )
        if not exists:
            await conn.execute(f'CREATE DATABASE "{url.database}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
def _migrated_database() -> None:
    import asyncio

    asyncio.run(_ensure_database())
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
    cfg.attributes["skip_logging_config"] = True
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session")
def engine() -> AsyncEngine:
    return create_async_engine(settings.DATABASE_URL, poolclass=NullPool)


@pytest.fixture
async def db_session(engine: AsyncEngine) -> AsyncGenerator[AsyncSession]:
    """A session inside a transaction that is rolled back after the test."""
    async with engine.connect() as conn:
        trans = await conn.begin()
        session = AsyncSession(
            bind=conn,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
        )
        try:
            yield session
        finally:
            await session.close()
            await trans.rollback()


@pytest.fixture
async def redis() -> AsyncGenerator[fakeredis.FakeAsyncRedis]:
    client = fakeredis.FakeAsyncRedis(decode_responses=True)
    yield client
    await client.flushall()
    await client.aclose()


@pytest.fixture(autouse=True)
def _reset_replay_readers() -> None:
    replay._readers.clear()


@pytest.fixture
def app(db_session: AsyncSession, redis: fakeredis.FakeAsyncRedis) -> FastAPI:
    app = create_app()
    app.dependency_overrides[get_session] = lambda: db_session
    app.dependency_overrides[get_redis] = lambda: redis
    return app


@pytest.fixture(autouse=True)
def _reset_station_index_memo() -> None:
    station_index.clear_memo()


@pytest.fixture
def otp(monkeypatch: pytest.MonkeyPatch) -> Iterator[respx.MockRouter]:
    """Mocked upstream GraphQL endpoint; no request leaves the process."""
    from tests.upstream import ENDPOINT

    monkeypatch.setattr(settings, "GRAPHQL_ENDPOINT", ENDPOINT)
    monkeypatch.setattr(settings, "SOCKS5_PROXY_ENABLE", False)
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as mock:
        yield mock


@pytest.fixture
async def client(app: FastAPI) -> AsyncGenerator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
