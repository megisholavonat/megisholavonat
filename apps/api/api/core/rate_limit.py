"""Fixed-window rate limiting in Redis"""

import ipaddress
import time

from fastapi import HTTPException, status
from redis.asyncio import Redis

from api.core.redis import add_key

# IPv6 clients usually control a whole /64, so they are limited per /64
IPV6_PREFIX = 64


def rate_limit_bucket(ip: str) -> str:
    """Rate limit key of an address: the address itself, or its /64 for IPv6."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped:
            return str(addr.ipv4_mapped)
        return str(ipaddress.IPv6Network((addr, IPV6_PREFIX), strict=False))
    return str(addr)


async def hit(redis: Redis, name: str, limit: int, window_s: int) -> int | None:
    """
    Count one request against `name`. Returns None if allowed, otherwise the
    seconds until the window resets.
    """
    now = int(time.time())
    window = now // window_s
    key = add_key(f"ratelimit:{name}:{window}")
    async with redis.pipeline(transaction=True) as pipe:
        pipe.incr(key)
        pipe.expire(key, window_s)
        count, _ = await pipe.execute()
    if int(count) > limit:
        return window_s - now % window_s
    return None


def too_many_requests(retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many requests",
        headers={"Retry-After": str(retry_after)},
    )
