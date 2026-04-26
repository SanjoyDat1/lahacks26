"""Lightweight routes for probes (GET /). Slack lives in routes/slack.py (POST /slack/events)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

router = APIRouter(tags=["compat"])


@router.get("/")
def root() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "brain-api",
        "health": "/health",
        "slack_events": "POST /slack/events (Events API on this server) or POST {next-app}/api/ingest/slack",
    }
