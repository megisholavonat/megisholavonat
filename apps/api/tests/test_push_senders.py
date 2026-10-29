import base64
import json
import uuid
from collections.abc import Iterator

import fakeredis
import httpx
import pytest
import respx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from api.core.redis import add_key
from api.services.push_senders import (
    EXPO_PUSH_URL,
    EXPO_RECEIPTS_URL,
    ApnsLiveActivitySender,
    ExpoMessage,
    ExpoPushSender,
    LiveActivityMessage,
    Outcome,
)
from api.tasks import data

APNS_URL = "https://api.sandbox.push.apple.com/3/device/"


@pytest.fixture
def mock() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as router:
        yield router


def expo_message(i: int) -> ExpoMessage:
    return ExpoMessage(
        uuid.UUID(int=i + 1), f"ExponentPushToken[{i}]", "S70 · +12 perc", None, {}
    )


async def test_expo_batches_and_maps_tickets(mock: respx.MockRouter) -> None:
    requests: list[list[dict[str, object]]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        batch = json.loads(request.content)
        requests.append(batch)
        tickets = [
            {
                "status": "error",
                "message": "not registered",
                "details": {"error": "DeviceNotRegistered"},
            }
            if m["to"] == "ExponentPushToken[3]"
            else {"status": "error", "message": "slow down"}
            if m["to"] == "ExponentPushToken[4]"
            else {"status": "ok", "id": f"t-{m['to']}"}
            for m in batch
        ]
        assert request.headers["Authorization"] == "Bearer secret"
        return httpx.Response(200, json={"data": tickets})

    mock.post(EXPO_PUSH_URL).mock(side_effect=respond)
    sender = ExpoPushSender("secret")
    results = await sender.send([expo_message(i) for i in range(150)])
    await sender.aclose()

    assert [len(r) for r in requests] == [100, 50]
    assert requests[0][0] == {
        "to": "ExponentPushToken[0]",
        "title": "S70 · +12 perc",
        "data": {},
        "sound": "default",
        "priority": "high",
        "channelId": "train-alerts",
    }
    assert len(results) == 150
    assert results[0].outcome == Outcome.OK
    assert results[0].ticket_id == "t-ExponentPushToken[0]"
    assert results[3].outcome == Outcome.UNREGISTERED
    assert results[4].outcome == Outcome.FAILED
    assert results[4].error == "slow down"


async def test_expo_failure_never_raises(mock: respx.MockRouter) -> None:
    mock.post(EXPO_PUSH_URL).mock(return_value=httpx.Response(500))
    results = await ExpoPushSender("secret").send([expo_message(0)])
    assert [r.outcome for r in results] == [Outcome.FAILED]

    mock.post(EXPO_PUSH_URL).mock(side_effect=httpx.ConnectError("down"))
    results = await ExpoPushSender("secret").send([expo_message(0)])
    assert [r.outcome for r in results] == [Outcome.FAILED]


async def test_expo_without_token_is_skipped(mock: respx.MockRouter) -> None:
    route = mock.post(EXPO_PUSH_URL)
    sender = ExpoPushSender(None)
    results = await sender.send([expo_message(0)])
    assert [r.outcome for r in results] == [Outcome.SKIPPED]
    assert await sender.receipts(["t"]) == {}
    assert not route.called


async def test_expo_receipts(mock: respx.MockRouter) -> None:
    mock.post(EXPO_RECEIPTS_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "a": {"status": "ok"},
                    "b": {
                        "status": "error",
                        "details": {"error": "DeviceNotRegistered"},
                    },
                }
            },
        )
    )
    receipts = await ExpoPushSender("secret").receipts(["a", "b", "c"])
    assert {k: v.outcome for k, v in receipts.items()} == {
        "a": Outcome.OK,
        "b": Outcome.UNREGISTERED,
    }


@pytest.fixture
def p8() -> tuple[str, ec.EllipticCurvePrivateKey]:
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return pem, key


def _unb64(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def la_message(alert: bool = False) -> LiveActivityMessage:
    return LiveActivityMessage(
        uuid.UUID(int=1),
        "abcd",
        "update",
        {"delayMin": 12, "nextStop": "Érd", "platform": "3", "eta": 1_800_000_000},
        1_700_000_000,
        alert=("S70 · +12 perc · Kelenföld 14:32", None) if alert else None,
        stale_date=1_700_000_600,
    )


async def test_apns_live_activity_request(
    mock: respx.MockRouter, p8: tuple[str, ec.EllipticCurvePrivateKey]
) -> None:
    pem, key = p8
    route = mock.post(APNS_URL + "abcd").mock(return_value=httpx.Response(200))
    # Newlines escaped, as in a one-line environment variable
    sender = ApnsLiveActivitySender(
        "KEY123", "TEAM45", pem.replace("\n", "\\n"), "hu.mhav.app", use_sandbox=True
    )
    assert sender.enabled
    [result] = await sender.send([la_message(alert=True)])
    await sender.aclose()
    assert result.outcome == Outcome.OK

    request = route.calls.last.request
    assert request.headers["apns-push-type"] == "liveactivity"
    assert request.headers["apns-topic"] == "hu.mhav.app.push-type.liveactivity"
    assert request.headers["apns-priority"] == "10"
    assert json.loads(request.content) == {
        "aps": {
            "timestamp": 1_700_000_000,
            "event": "update",
            "content-state": {
                "delayMin": 12,
                "nextStop": "Érd",
                "platform": "3",
                "eta": 1_800_000_000,
            },
            "stale-date": 1_700_000_600,
            "alert": {"title": "S70 · +12 perc · Kelenföld 14:32", "body": ""},
            "sound": "default",
        }
    }

    # A valid ES256 provider token
    scheme, jwt = request.headers["authorization"].split()
    assert scheme == "bearer"
    header, claims, signature = jwt.split(".")
    assert json.loads(_unb64(header)) == {"alg": "ES256", "kid": "KEY123"}
    assert json.loads(_unb64(claims))["iss"] == "TEAM45"
    raw = _unb64(signature)
    der = encode_dss_signature(
        int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")
    )
    key.public_key().verify(
        der, f"{header}.{claims}".encode(), ec.ECDSA(hashes.SHA256())
    )


async def test_apns_silent_update_and_errors(
    mock: respx.MockRouter, p8: tuple[str, ec.EllipticCurvePrivateKey]
) -> None:
    sender = ApnsLiveActivitySender("K", "T", p8[0], "hu.mhav.app", use_sandbox=True)
    route = mock.post(APNS_URL + "abcd")

    route.mock(return_value=httpx.Response(200))
    await sender.send([la_message()])
    assert route.calls.last.request.headers["apns-priority"] == "5"

    route.mock(return_value=httpx.Response(410, json={"reason": "Unregistered"}))
    [gone] = await sender.send([la_message()])
    assert gone.outcome == Outcome.UNREGISTERED

    route.mock(return_value=httpx.Response(429, json={"reason": "TooManyRequests"}))
    [busy] = await sender.send([la_message()])
    assert busy.outcome == Outcome.FAILED
    assert busy.error == "TooManyRequests"

    route.mock(side_effect=httpx.ConnectError("down"))
    [down] = await sender.send([la_message()])
    assert down.outcome == Outcome.FAILED


async def test_apns_without_credentials_is_skipped(mock: respx.MockRouter) -> None:
    route = mock.post(url__startswith="https://api.")
    for sender in (
        ApnsLiveActivitySender(None, None, None, None),
        ApnsLiveActivitySender("K", "T", "not a key", "hu.mhav.app"),
    ):
        assert not sender.enabled
        [result] = await sender.send([la_message()])
        assert result.outcome == Outcome.SKIPPED
    assert not route.called


# --- The refresh does not depend on alerts ---


async def test_refresh_survives_failing_follow_up_tasks(
    redis: fakeredis.FakeAsyncRedis, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fail() -> None:
        raise RuntimeError("broker down")

    monkeypatch.setattr(data.evaluate_alerts, "kiq", fail)
    monkeypatch.setattr(data.record_history, "kiq", fail)
    await data.refresh_data(redis)  # type: ignore[call-arg]
    assert await redis.hlen(add_key("train-positions-hash")) > 0  # type: ignore[misc]


async def test_refresh_enqueues_alert_evaluation(
    redis: fakeredis.FakeAsyncRedis, monkeypatch: pytest.MonkeyPatch
) -> None:
    enqueued = []

    async def record(name: str) -> None:
        enqueued.append(name)

    monkeypatch.setattr(data.evaluate_alerts, "kiq", lambda: record("alerts"))
    monkeypatch.setattr(data.record_history, "kiq", lambda: record("history"))
    await data.refresh_data(redis)  # type: ignore[call-arg]
    assert enqueued == ["history", "alerts"]
