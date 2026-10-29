"""
Native push delivery: Expo (iOS and Android notifications) and APNs (iOS Live
Activity updates). There is no web push.

Senders never raise: every message gets a SendResult, so a broken network or
bad credentials cannot crash the worker. Without credentials a sender logs
once and reports every message as SKIPPED.
"""

import asyncio
import base64
import json
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from itertools import batched
from typing import Any, Literal, Protocol

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.serialization import load_pem_private_key

from api.core.config import Settings, settings
from api.core.logging_config import get_logger

logger = get_logger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
EXPO_BATCH_SIZE = 100
EXPO_RECEIPTS_BATCH_SIZE = 1000
# Android notification channel of every alert. The app must create it (the
# mobile scaffold will), or Android 8+ does not show the notification
ANDROID_CHANNEL_ID = "train-alerts"

APNS_HOST = "https://api.push.apple.com"
APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com"
# Provider tokens must be refreshed between 20 and 60 minutes
APNS_JWT_TTL_S = 50 * 60
APNS_CONCURRENCY = 20
# APNs reasons meaning the token will never work again
APNS_GONE_REASONS = frozenset({"BadDeviceToken", "Unregistered", "ExpiredToken"})

TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class Outcome(StrEnum):
    OK = "ok"
    # Delivery failed; the token may work later
    FAILED = "failed"
    # The token is dead and should be deleted
    UNREGISTERED = "unregistered"
    # Not sent: the sender has no credentials
    SKIPPED = "skipped"


@dataclass(frozen=True, slots=True)
class SendResult:
    token_id: uuid.UUID
    outcome: Outcome
    error: str | None = None
    # Expo push ticket, whose receipt is checked later
    ticket_id: str | None = None


@dataclass(frozen=True, slots=True)
class ExpoMessage:
    token_id: uuid.UUID
    token: str
    title: str
    body: str | None = None
    data: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class LiveActivityMessage:
    token_id: uuid.UUID
    token: str
    event: Literal["update", "end"]
    content_state: dict[str, Any]
    # Unix seconds; APNs drops updates older than the last one it delivered
    timestamp: int
    # Shown as a banner with the update (title, body)
    alert: tuple[str, str | None] | None = None
    stale_date: int | None = None
    dismissal_date: int | None = None
    # Orders this app's activities in the Dynamic Island (higher first)
    relevance_score: float | None = None


class PushSender[M](Protocol):
    async def send(self, messages: Sequence[M]) -> list[SendResult]: ...

    async def aclose(self) -> None: ...


class ExpoSender(PushSender[ExpoMessage], Protocol):
    async def receipts(self, ticket_ids: Sequence[str]) -> dict[str, SendResult]:
        """Receipts of earlier tickets that are ready, by ticket id."""
        ...


LiveActivitySender = PushSender[LiveActivityMessage]


def _expo_outcome(entry: dict[str, Any]) -> tuple[Outcome, str | None]:
    if entry.get("status") == "ok":
        return Outcome.OK, None
    details = entry.get("details") or {}
    error = details.get("error") or entry.get("message") or "unknown error"
    if details.get("error") == "DeviceNotRegistered":
        return Outcome.UNREGISTERED, error
    return Outcome.FAILED, str(error)


class ExpoPushSender:
    """Expo push API: up to 100 messages per request, receipts checked later."""

    def __init__(
        self, access_token: str | None, client: httpx.AsyncClient | None = None
    ) -> None:
        self.access_token = access_token
        self._client = client
        self._warned = False

    @classmethod
    def from_settings(cls, config: Settings = settings) -> "ExpoPushSender":
        return cls(config.EXPO_ACCESS_TOKEN)

    @property
    def enabled(self) -> bool:
        return bool(self.access_token)

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=TIMEOUT)
        return self._client

    def _headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.access_token}",
        }

    def _skip(self, count: int) -> bool:
        if self.enabled:
            return False
        if count and not self._warned:
            logger.warning("EXPO_ACCESS_TOKEN is not set; Expo pushes are skipped")
            self._warned = True
        return True

    async def send(self, messages: Sequence[ExpoMessage]) -> list[SendResult]:
        if self._skip(len(messages)):
            return [SendResult(m.token_id, Outcome.SKIPPED) for m in messages]
        results: list[SendResult] = []
        for chunk in batched(messages, EXPO_BATCH_SIZE, strict=False):
            results.extend(await self._send_batch(chunk))
        return results

    async def _send_batch(self, chunk: Sequence[ExpoMessage]) -> list[SendResult]:
        payload = []
        for m in chunk:
            message: dict[str, Any] = {
                "to": m.token,
                "title": m.title,
                "data": m.data,
                "sound": "default",
                "priority": "high",
                "channelId": ANDROID_CHANNEL_ID,
            }
            if m.body:
                message["body"] = m.body
            payload.append(message)
        try:
            response = await self._http().post(
                EXPO_PUSH_URL, json=payload, headers=self._headers()
            )
            response.raise_for_status()
            tickets = response.json()["data"]
            if not isinstance(tickets, list) or len(tickets) != len(chunk):
                raise ValueError("ticket count does not match the messages")
        except Exception as e:
            logger.error(f"Expo push request failed: {e!r}")
            return [SendResult(m.token_id, Outcome.FAILED, repr(e)) for m in chunk]

        results = []
        for m, ticket in zip(chunk, tickets, strict=True):
            outcome, error = _expo_outcome(ticket)
            results.append(SendResult(m.token_id, outcome, error, ticket.get("id")))
        return results

    async def receipts(self, ticket_ids: Sequence[str]) -> dict[str, SendResult]:
        """
        Receipts by ticket id. `token_id` is a placeholder (the nil UUID); the
        caller maps tickets back to tokens. Missing ids are not ready yet.
        """
        if self._skip(len(ticket_ids)):
            return {}
        receipts: dict[str, SendResult] = {}
        for chunk in batched(ticket_ids, EXPO_RECEIPTS_BATCH_SIZE, strict=False):
            try:
                response = await self._http().post(
                    EXPO_RECEIPTS_URL,
                    json={"ids": list(chunk)},
                    headers=self._headers(),
                )
                response.raise_for_status()
                data = response.json()["data"]
            except Exception as e:
                logger.error(f"Expo receipts request failed: {e!r}")
                continue
            for ticket_id, entry in data.items():
                outcome, error = _expo_outcome(entry)
                receipts[ticket_id] = SendResult(uuid.UUID(int=0), outcome, error)
        return receipts

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def apns_jwt(
    key: ec.EllipticCurvePrivateKey, key_id: str, team_id: str, iat: int
) -> str:
    """ES256 provider token for APNs token-based auth."""
    header = _b64url(json.dumps({"alg": "ES256", "kid": key_id}).encode())
    claims = _b64url(json.dumps({"iss": team_id, "iat": iat}).encode())
    signing_input = f"{header}.{claims}".encode()
    r, s = decode_dss_signature(key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    signature = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return f"{header}.{claims}.{_b64url(signature)}"


def live_activity_payload(message: LiveActivityMessage) -> dict[str, Any]:
    aps: dict[str, Any] = {
        "timestamp": message.timestamp,
        "event": message.event,
        "content-state": message.content_state,
    }
    if message.stale_date is not None:
        aps["stale-date"] = message.stale_date
    if message.dismissal_date is not None:
        aps["dismissal-date"] = message.dismissal_date
    if message.relevance_score is not None:
        aps["relevance-score"] = message.relevance_score
    if message.alert is not None:
        title, body = message.alert
        aps["alert"] = {"title": title, "body": body or ""}
        aps["sound"] = "default"
    return {"aps": aps}


class ApnsLiveActivitySender:
    """Live Activity updates over HTTP/2 to APNs, with token-based auth."""

    def __init__(
        self,
        key_id: str | None,
        team_id: str | None,
        private_key: str | None,
        bundle_id: str | None,
        use_sandbox: bool = False,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.key_id = key_id
        self.team_id = team_id
        self.bundle_id = bundle_id
        self.host = APNS_SANDBOX_HOST if use_sandbox else APNS_HOST
        self._client = client
        self._warned = False
        self._jwt: tuple[str, float] | None = None
        self._key: ec.EllipticCurvePrivateKey | None = None
        if private_key:
            try:
                pem = private_key.replace("\\n", "\n").strip().encode()
                key = load_pem_private_key(pem, password=None)
                if not isinstance(key, ec.EllipticCurvePrivateKey):
                    raise TypeError("not an EC private key")
                self._key = key
            except Exception as e:
                logger.error(f"APNS_PRIVATE_KEY is unusable: {e!r}")

    @classmethod
    def from_settings(cls, config: Settings = settings) -> "ApnsLiveActivitySender":
        return cls(
            config.APNS_KEY_ID,
            config.APNS_TEAM_ID,
            config.APNS_PRIVATE_KEY,
            config.APNS_BUNDLE_ID,
            config.APNS_USE_SANDBOX,
        )

    @property
    def enabled(self) -> bool:
        return bool(self.key_id and self.team_id and self.bundle_id and self._key)

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(http2=True, timeout=TIMEOUT)
        return self._client

    def _token(self) -> str:
        now = time.time()
        if self._jwt is None or now - self._jwt[1] > APNS_JWT_TTL_S:
            assert self._key is not None
            assert self.key_id is not None
            assert self.team_id is not None
            jwt = apns_jwt(self._key, self.key_id, self.team_id, int(now))
            self._jwt = (jwt, now)
        return self._jwt[0]

    async def send(self, messages: Sequence[LiveActivityMessage]) -> list[SendResult]:
        if not self.enabled:
            if messages and not self._warned:
                logger.warning(
                    "APNs credentials are not set; Live Activity updates are skipped"
                )
                self._warned = True
            return [SendResult(m.token_id, Outcome.SKIPPED) for m in messages]
        semaphore = asyncio.Semaphore(APNS_CONCURRENCY)

        async def one(m: LiveActivityMessage) -> SendResult:
            async with semaphore:
                return await self._send_one(m)

        return list(await asyncio.gather(*(one(m) for m in messages)))

    async def _send_one(self, m: LiveActivityMessage) -> SendResult:
        try:
            headers = {
                "authorization": f"bearer {self._token()}",
                "apns-push-type": "liveactivity",
                "apns-topic": f"{self.bundle_id}.push-type.liveactivity",
                # 10 wakes the device and counts against the activity's
                # budget, so only updates carrying an alert or the end use it
                "apns-priority": "10" if m.alert or m.event == "end" else "5",
            }
            # An update held for an offline phone is worthless once stale
            if m.stale_date is not None:
                headers["apns-expiration"] = str(m.stale_date)
            response = await self._http().post(
                f"{self.host}/3/device/{m.token}",
                json=live_activity_payload(m),
                headers=headers,
            )
        except Exception as e:
            logger.error(f"APNs request failed: {e!r}")
            return SendResult(m.token_id, Outcome.FAILED, repr(e))

        if response.status_code == 200:
            return SendResult(m.token_id, Outcome.OK)
        try:
            reason = str(response.json().get("reason") or response.status_code)
        except ValueError:
            reason = str(response.status_code)
        if reason == "ExpiredProviderToken":
            self._jwt = None
        if response.status_code == 410 or reason in APNS_GONE_REASONS:
            return SendResult(m.token_id, Outcome.UNREGISTERED, reason)
        logger.warning(f"APNs rejected a Live Activity update: {reason}")
        return SendResult(m.token_id, Outcome.FAILED, reason)

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
