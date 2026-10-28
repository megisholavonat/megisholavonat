import uuid
from datetime import datetime
from typing import Literal

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
