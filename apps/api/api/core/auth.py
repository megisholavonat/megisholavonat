"""
Anonymous device authentication.

A device gets an id and a random token when it registers; only the token's
sha256 is stored. Clients send `Authorization: Bearer <deviceId>.<token>`.
"""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import update

from api.core.db import SessionDep
from api.models.devices import Device

# The 32-byte token's sha256 is compared against this when the device id is
# unknown, so unknown ids and wrong tokens take the same time
_DUMMY_HASH = hashlib.sha256(b"").digest()

bearer_scheme = HTTPBearer(
    scheme_name="DeviceToken",
    description="`<deviceId>.<token>` as returned by POST /v1/devices",
    auto_error=False,
)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def format_credentials(device_id: uuid.UUID, token: str) -> str:
    return f"{device_id}.{token}"


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def parse_credentials(credentials: str) -> tuple[uuid.UUID, str] | None:
    device_part, sep, token = credentials.partition(".")
    if not sep or not token:
        return None
    try:
        return uuid.UUID(device_part), token
    except ValueError:
        return None


async def get_current_device(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> Device:
    if credentials is None:
        raise _unauthorized("Missing bearer token")
    parsed = parse_credentials(credentials.credentials)
    if parsed is None:
        raise _unauthorized("Malformed bearer token")
    device_id, token = parsed

    device = await session.get(Device, device_id)
    expected = device.token_hash if device is not None else _DUMMY_HASH
    if not hmac.compare_digest(hash_token(token), expected) or device is None:
        raise _unauthorized("Invalid device token")

    # Activity is tracked per day, so most requests do not write
    now = datetime.now(UTC)
    if device.last_seen_at.astimezone(UTC).date() < now.date():
        await session.execute(
            update(Device).where(Device.id == device.id).values(last_seen_at=now)
        )
        await session.commit()
        device.last_seen_at = now
    return device


DeviceDep = Annotated[Device, Depends(get_current_device)]
