"""Anonymous devices"""

import uuid
from typing import Any

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import update

from api.core.auth import DeviceDep, hash_token, new_token
from api.core.config import settings
from api.core.db import SessionDep
from api.core.rate_limit import client_ip, hit, rate_limit_bucket, too_many_requests
from api.core.redis import RedisDep
from api.models.devices import Device
from api.schemas.devices import DeviceCreate, DeviceCredentials, DeviceInfo
from api.services.devices import erase_device

router = APIRouter(prefix="/devices", tags=["devices"])

REGISTRATION_WINDOW_S = 3600

AUTH_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"description": "Missing, malformed or invalid device token"}
}


def _info(device: Device) -> DeviceInfo:
    return DeviceInfo(
        deviceId=device.id,
        platform=device.platform,  # type: ignore[arg-type]
        locale=device.locale,
        createdAt=device.created_at,
        lastSeenAt=device.last_seen_at,
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    responses={429: {"description": "Too many registrations; see Retry-After"}},
)
async def register_device(
    body: DeviceCreate, request: Request, session: SessionDep, redis: RedisDep
) -> DeviceCredentials:
    """
    Register an anonymous device. The token is returned only here and from
    rotate-token; store it securely.
    """
    ip = rate_limit_bucket(client_ip(request))
    retry_after = await hit(
        redis,
        f"device-register:ip:{ip}",
        settings.DEVICE_REGISTRATIONS_PER_IP_PER_HOUR,
        REGISTRATION_WINDOW_S,
    ) or await hit(
        redis,
        "device-register:global",
        settings.DEVICE_REGISTRATIONS_PER_HOUR,
        REGISTRATION_WINDOW_S,
    )
    if retry_after is not None:
        raise too_many_requests(retry_after)

    token = new_token()
    device = Device(
        id=uuid.uuid4(),
        token_hash=hash_token(token),
        platform=body.platform,
        locale=body.locale,
    )
    session.add(device)
    await session.commit()
    return DeviceCredentials(deviceId=device.id, token=token)


@router.get("/me", responses=AUTH_RESPONSES)
async def get_device(device: DeviceDep) -> DeviceInfo:
    """The calling device"""
    return _info(device)


@router.post("/me/rotate-token", responses=AUTH_RESPONSES)
async def rotate_device_token(
    device: DeviceDep, session: SessionDep
) -> DeviceCredentials:
    """Issue a new token; the current one stops working immediately."""
    token = new_token()
    await session.execute(
        update(Device)
        .where(Device.id == device.id)
        .values(token_hash=hash_token(token))
    )
    await session.commit()
    return DeviceCredentials(deviceId=device.id, token=token)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT, responses=AUTH_RESPONSES)
async def delete_device(
    device: DeviceDep, session: SessionDep, redis: RedisDep
) -> Response:
    """Delete this device and everything stored about it (follows included)."""
    await erase_device(session, redis, device.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
