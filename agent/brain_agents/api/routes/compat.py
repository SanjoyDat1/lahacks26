"""Routes some clients hit on brain-api:8000 by mistake (Slack, browser GET /)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from fastapi import APIRouter, Request, Response

router = APIRouter(tags=["compat"])


@router.get("/")
def root() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "brain-api",
        "health": "/health",
        "slack_events": (
            "Configure Slack Event Subscriptions to POST your Next.js URL: "
            "{app}/api/ingest/slack — not this server. "
            "Or set FRONTEND_BASE_URL so POST /slack/events proxies there."
        ),
    }


def _frontend_base() -> str:
    return (os.getenv("FRONTEND_BASE_URL") or os.getenv("NEXT_PUBLIC_APP_URL") or "").strip().rstrip("/")


def _proxy_slack_to_next(body: bytes, header_items: list[tuple[str, str]]) -> tuple[bytes, int, str | None]:
    base = _frontend_base()
    if not base:
        detail = {
            "detail": (
                "Slack must call the Next.js ingest URL: POST {your-app}/api/ingest/slack. "
                "This brain-api path is optional: set FRONTEND_BASE_URL (or NEXT_PUBLIC_APP_URL) "
                "to proxy POST /slack/events to that app."
            )
        }
        return json.dumps(detail).encode(), 503, "application/json"

    url = f"{base}/api/ingest/slack"
    req = urllib.request.Request(url, data=body, method="POST")
    for name, value in header_items:
        req.add_header(name, value)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            ct = resp.headers.get("content-type")
            return resp.read(), resp.status, ct
    except urllib.error.HTTPError as e:
        return e.read(), e.code, e.headers.get("content-type") if e.headers else "application/json"
    except OSError:
        err = {"detail": "proxy_failed", "target": url}
        return json.dumps(err).encode(), 502, "application/json"


@router.post("/slack/events")
async def slack_events(request: Request) -> Response:
    body = await request.body()
    forward_headers: list[tuple[str, str]] = []
    for name in ("x-slack-signature", "x-slack-request-timestamp", "content-type", "authorization"):
        v = request.headers.get(name)
        if v:
            forward_headers.append((name, v))

    out, status, ct = _proxy_slack_to_next(body, forward_headers)
    return Response(content=out, status_code=status, media_type=ct or "application/json")
