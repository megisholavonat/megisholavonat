"""Which address a request came from, behind trusted reverse proxies"""

import ipaddress

from fastapi import Request
from starlette.types import ASGIApp, Receive, Scope, Send

# Where ClientIPHeaderMiddleware leaves an accepted header address
STATE_KEY = "client_ip_from_header"


def _parse_networks(
    proxies: list[str],
) -> list[ipaddress.IPv4Network | ipaddress.IPv6Network] | None:
    """The trusted networks, or None if "*" trusts every peer."""
    if "*" in proxies:
        return None
    return [ipaddress.ip_network(p, strict=False) for p in proxies]


def _parse_ip(value: str) -> str | None:
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


class ClientIPHeaderMiddleware:
    """
    Takes the client address from a single-value header set by the edge, such
    as Cloudflare's CF-Connecting-IP, but only for connections whose TCP peer
    is in `trusted_proxies`; anyone else could send the header themselves.

    It has to see the raw TCP peer, so it must run before (outside)
    ProxyHeadersMiddleware, which rewrites the client from X-Forwarded-For.
    The accepted address is stored in the request state and read by
    client_ip(); the scope's client is left for ProxyHeadersMiddleware.
    """

    def __init__(self, app: ASGIApp, header: str, trusted_proxies: list[str]):
        self.app = app
        self.header = header.lower().encode("latin-1")
        self.networks = _parse_networks(trusted_proxies)

    def _trusted(self, host: str) -> bool:
        if self.networks is None:
            return True
        try:
            addr = ipaddress.ip_address(host)
        except ValueError:
            return False
        return any(addr in net for net in self.networks)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            peer = scope.get("client")
            if peer and self._trusted(peer[0]):
                for name, value in scope["headers"]:
                    if name == self.header:
                        ip = _parse_ip(value.decode("latin-1"))
                        if ip is not None:
                            scope.setdefault("state", {})[STATE_KEY] = ip
                        break
        await self.app(scope, receive, send)


def client_ip(request: Request) -> str:
    """
    The client address: CLIENT_IP_HEADER if ClientIPHeaderMiddleware accepted
    it, otherwise the peer as resolved by ProxyHeadersMiddleware (the
    X-Forwarded-For client for requests from TRUSTED_PROXIES, else the TCP
    peer).
    """
    ip = getattr(request.state, STATE_KEY, None)
    if ip:
        return str(ip)
    return request.client.host if request.client else "unknown"
