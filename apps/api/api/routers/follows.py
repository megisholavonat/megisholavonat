"""Trains a device follows: single trips and recurring commutes"""

import uuid
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from api.core.auth import DeviceDep
from api.core.db import SessionDep
from api.models.devices import (
    Device,
    Follow,
    mask_to_weekdays,
    weekdays_to_mask,
)
from api.schemas.follows import (
    CommuteFollow,
    CommuteFollowCreate,
    FollowCreate,
    FollowUpdate,
    TripFollow,
    TripFollowCreate,
)
from api.schemas.follows import Follow as FollowSchema
from api.services.devices import TRIP_FOLLOW_KEEP_DAYS
from api.util.time import BUDAPEST_TZ

router = APIRouter(
    prefix="/follows",
    tags=["follows"],
    responses={401: {"description": "Missing, malformed or invalid device token"}},
)

MAX_FOLLOWS_PER_DEVICE = 50

NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"description": "No such follow on this device"}
}
COMMUTE_ONLY_FIELDS = ("weekdays", "fromStationId", "toStationId", "label")


def _oldest_followable_date() -> date:
    # Anything older would be removed by the next housekeeping run
    today = datetime.now(BUDAPEST_TZ).date()
    return today - timedelta(days=TRIP_FOLLOW_KEEP_DAYS - 1)


def to_schema(follow: Follow) -> TripFollow | CommuteFollow:
    common = {
        "id": follow.id,
        "tripShortName": follow.trip_short_name,
        "alertsEnabled": follow.alerts_enabled,
        "delayThresholdMin": follow.delay_threshold_min,
        "notifyPlatformChange": follow.notify_platform_change,
        "createdAt": follow.created_at,
        "updatedAt": follow.updated_at,
    }
    if follow.kind == "trip":
        return TripFollow(
            kind="trip",
            tripId=follow.trip_id or "",
            serviceDate=follow.service_date,  # type: ignore[arg-type]
            fromStopId=follow.from_stop_id,
            toStopId=follow.to_stop_id,
            **common,
        )
    return CommuteFollow(
        kind="commute",
        weekdays=mask_to_weekdays(follow.weekdays or 0),
        fromStationId=follow.from_station_id or "",
        toStationId=follow.to_station_id,
        label=follow.label,
        **common,
    )


async def _get_owned(
    session: SessionDep, device: Device, follow_id: uuid.UUID
) -> Follow:
    # Another device's follow is indistinguishable from a missing one
    follow = await session.scalar(
        select(Follow).where(Follow.id == follow_id, Follow.device_id == device.id)
    )
    if follow is None:
        raise HTTPException(status_code=404, detail="Follow not found")
    return follow


@router.get("")
async def list_follows(device: DeviceDep, session: SessionDep) -> list[FollowSchema]:
    """Follows of the calling device, oldest first"""
    follows = await session.scalars(
        select(Follow)
        .where(Follow.device_id == device.id)
        .order_by(Follow.created_at, Follow.id)
    )
    return [to_schema(f) for f in follows]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    responses={
        409: {
            "description": f"Already following this trip, or the limit of "
            f"{MAX_FOLLOWS_PER_DEVICE} follows is reached"
        }
    },
)
async def create_follow(
    body: FollowCreate, device: DeviceDep, session: SessionDep
) -> FollowSchema:
    """Follow a single trip or a recurring commute"""
    follow = Follow(
        id=uuid.uuid4(),
        device_id=device.id,
        kind=body.kind,
        trip_short_name=body.tripShortName,
        alerts_enabled=body.alertsEnabled,
        delay_threshold_min=body.delayThresholdMin,
        notify_platform_change=body.notifyPlatformChange,
    )
    if isinstance(body, TripFollowCreate):
        if body.serviceDate < _oldest_followable_date():
            raise HTTPException(
                status_code=422, detail="serviceDate is too far in the past"
            )
        follow.trip_id = body.tripId
        follow.service_date = body.serviceDate
        follow.from_stop_id = body.fromStopId
        follow.to_stop_id = body.toStopId
    else:
        assert isinstance(body, CommuteFollowCreate)
        follow.weekdays = weekdays_to_mask(body.weekdays)
        follow.from_station_id = body.fromStationId
        follow.to_station_id = body.toStationId
        follow.label = body.label

    # Lock the device row so concurrent requests cannot exceed the cap
    await session.execute(
        select(Device.id).where(Device.id == device.id).with_for_update()
    )
    count = await session.scalar(
        select(func.count()).select_from(Follow).where(Follow.device_id == device.id)
    )
    if (count or 0) >= MAX_FOLLOWS_PER_DEVICE:
        await session.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"A device can follow at most {MAX_FOLLOWS_PER_DEVICE} trains",
        )

    session.add(follow)
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(
            status_code=409, detail="Already following this trip"
        ) from e
    await session.refresh(follow)
    return to_schema(follow)


@router.patch("/{follow_id}", responses=NOT_FOUND)
async def update_follow(
    follow_id: uuid.UUID, body: FollowUpdate, device: DeviceDep, session: SessionDep
) -> FollowSchema:
    """Change alert preferences, or a commute's days, stations or label"""
    follow = await _get_owned(session, device, follow_id)
    fields = body.model_fields_set

    if follow.kind != "commute" and fields & set(COMMUTE_ONLY_FIELDS):
        raise HTTPException(
            status_code=422,
            detail=f"{', '.join(COMMUTE_ONLY_FIELDS)} only apply to commutes",
        )
    for name in ("alertsEnabled", "delayThresholdMin", "notifyPlatformChange"):
        if name in fields and getattr(body, name) is None:
            raise HTTPException(status_code=422, detail=f"{name} cannot be null")
    if "weekdays" in fields and body.weekdays is None:
        raise HTTPException(status_code=422, detail="weekdays cannot be null")
    if "fromStationId" in fields and body.fromStationId is None:
        raise HTTPException(status_code=422, detail="fromStationId cannot be null")

    if body.alertsEnabled is not None:
        follow.alerts_enabled = body.alertsEnabled
    if body.delayThresholdMin is not None:
        follow.delay_threshold_min = body.delayThresholdMin
    if body.notifyPlatformChange is not None:
        follow.notify_platform_change = body.notifyPlatformChange
    if body.weekdays is not None:
        follow.weekdays = weekdays_to_mask(body.weekdays)
    if body.fromStationId is not None:
        follow.from_station_id = body.fromStationId
    if "toStationId" in fields:
        follow.to_station_id = body.toStationId
    if "label" in fields:
        follow.label = body.label

    await session.commit()
    await session.refresh(follow)
    return to_schema(follow)


@router.delete(
    "/{follow_id}", status_code=status.HTTP_204_NO_CONTENT, responses=NOT_FOUND
)
async def delete_follow(
    follow_id: uuid.UUID, device: DeviceDep, session: SessionDep
) -> Response:
    """Stop following"""
    follow = await _get_owned(session, device, follow_id)
    await session.delete(follow)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
