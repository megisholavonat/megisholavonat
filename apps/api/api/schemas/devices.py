import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

Platform = Literal["web", "ios", "android"]


class DeviceCreate(BaseModel):
    """Register an anonymous device"""

    platform: Platform
    # BCP 47 tag, e.g. "hu" or "en-GB"
    locale: str | None = Field(
        default=None, max_length=35, pattern=r"^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$"
    )


class DeviceCredentials(BaseModel):
    """
    Shown only once. Send `Authorization: Bearer <deviceId>.<token>` on every
    authenticated request.
    """

    deviceId: uuid.UUID
    token: str


class DeviceInfo(BaseModel):
    """The calling device"""

    deviceId: uuid.UUID
    platform: Platform
    locale: str | None
    createdAt: datetime
    # Updated at most once a day; devices idle for 180 days are deleted
    lastSeenAt: datetime


# ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
ExpoToken = Annotated[
    str,
    Field(
        pattern=r"^Expo(nent)?PushToken\[[^\]]{1,200}\]$",
        examples=["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"],
    ),
]
# Hex-encoded ActivityKit push token
LiveActivityToken = Annotated[str, Field(pattern=r"^[0-9a-fA-F]{16,512}$")]


class ExpoPushTokenCreate(BaseModel):
    """An Expo push token (iOS or Android): alerts about every follow"""

    type: Literal["expo"]
    token: ExpoToken


class LiveActivityPushTokenCreate(BaseModel):
    """
    The ActivityKit push token of one followed trip's iOS Live Activity. It
    receives `update` events while the train runs and `end` once it has passed
    the alighting station; alerts about that follow are shown on it instead of
    as a separate notification.
    """

    type: Literal["liveactivity"]
    token: LiveActivityToken
    followId: uuid.UUID


PushTokenCreate = Annotated[
    ExpoPushTokenCreate | LiveActivityPushTokenCreate, Field(discriminator="type")
]


class PushToken(BaseModel):
    """A registered push token; the token itself is not echoed back"""

    id: uuid.UUID
    type: Literal["expo", "liveactivity"]
    followId: uuid.UUID | None
    createdAt: datetime
