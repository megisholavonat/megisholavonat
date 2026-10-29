"""Anonymous devices"""

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert

from api.core.auth import DeviceDep, hash_token, new_token
from api.core.client_ip import client_ip
from api.core.config import settings
from api.core.db import SessionDep
from api.core.rate_limit import hit, rate_limit_bucket, too_many_requests
from api.core.redis import RedisDep
from api.models.devices import Device, Follow, PushToken
from api.schemas.devices import (
    DeviceCreate,
    DeviceCredentials,
    DeviceInfo,
    LiveActivityPushTokenCreate,
    PushTokenCreate,
)
from api.schemas.devices import PushToken as PushTokenSchema
from api.services.devices import erase_device

router = APIRouter(prefix="/devices", tags=["devices"])

REGISTRATION_WINDOW_S = 3600
MAX_PUSH_TOKENS_PER_DEVICE = 60
# Native push only: Expo for both apps, Live Activities on iOS
PUSH_PLATFORMS = {
    "expo": ("ios", "android"),
    "liveactivity": ("ios",),
    "liveactivity_start": ("ios",),
}

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


def _push_token_info(token: PushToken) -> PushTokenSchema:
    return PushTokenSchema(
        id=token.id,
        type=token.type,  # type: ignore[arg-type]
        followId=token.follow_id,
        createdAt=token.created_at,
    )


@router.post(
    "/me/push-tokens",
    status_code=status.HTTP_201_CREATED,
    responses={
        **AUTH_RESPONSES,
        404: {"description": "No such follow on this device"},
        409: {
            "description": f"The limit of {MAX_PUSH_TOKENS_PER_DEVICE} push tokens "
            "is reached"
        },
        422: {"description": "Invalid token, or wrong platform for its type"},
    },
)
async def register_push_token(
    body: PushTokenCreate, device: DeviceDep, session: SessionDep
) -> PushTokenSchema:
    """
    Register where this device receives alerts. Registering a token again is
    harmless; a token registered to another device moves to this one.
    """
    if device.platform not in PUSH_PLATFORMS[body.type]:
        raise HTTPException(
            status_code=422,
            detail=f"{body.type} tokens are not supported on {device.platform}",
        )
    follow_id = None
    if isinstance(body, LiveActivityPushTokenCreate):
        follow_id = await session.scalar(
            select(Follow.id).where(
                Follow.id == body.followId, Follow.device_id == device.id
            )
        )
        if follow_id is None:
            raise HTTPException(status_code=404, detail="Follow not found")

    # Lock the device row so concurrent requests cannot exceed the cap
    await session.execute(
        select(Device.id).where(Device.id == device.id).with_for_update()
    )
    if body.type == "liveactivity_start":
        # The push-to-start token rotates: the new one replaces the old
        await session.execute(
            delete(PushToken).where(
                PushToken.device_id == device.id,
                PushToken.type == "liveactivity_start",
                PushToken.token != body.token,
            )
        )
    count = await session.scalar(
        select(func.count())
        .select_from(PushToken)
        .where(PushToken.device_id == device.id, PushToken.token != body.token)
    )
    if (count or 0) >= MAX_PUSH_TOKENS_PER_DEVICE:
        await session.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"A device can have at most {MAX_PUSH_TOKENS_PER_DEVICE} "
            "push tokens",
        )

    values = {
        "device_id": device.id,
        "type": body.type,
        "follow_id": follow_id,
        "failure_count": 0,
        "last_failure_at": None,
        "last_error": None,
    }
    stmt = (
        insert(PushToken)
        .values(id=uuid.uuid4(), token=body.token, **values)
        .on_conflict_do_update(
            index_elements=[PushToken.token],
            set_={**values, "updated_at": func.now()},
        )
        .returning(PushToken)
    )
    token = (
        await session.scalars(stmt, execution_options={"populate_existing": True})
    ).one()
    await session.commit()
    return _push_token_info(token)


@router.delete(
    "/me/push-tokens/{token_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={**AUTH_RESPONSES, 404: {"description": "No such push token"}},
)
async def delete_push_token(
    token_id: uuid.UUID, device: DeviceDep, session: SessionDep
) -> Response:
    """Stop sending pushes to a token"""
    deleted = await session.scalar(
        delete(PushToken)
        .where(PushToken.id == token_id, PushToken.device_id == device.id)
        .returning(PushToken.id)
    )
    if deleted is None:
        raise HTTPException(status_code=404, detail="Push token not found")
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT, responses=AUTH_RESPONSES)
async def delete_device(
    device: DeviceDep, session: SessionDep, redis: RedisDep
) -> Response:
    """Delete this device and everything stored about it (follows, push tokens)."""
    await erase_device(session, redis, device.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
