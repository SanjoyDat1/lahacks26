"""Slack Events API + slash command webhook."""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, Request
from fastapi.responses import JSONResponse

from ...services import agent_runner
from ...services.slack_significance import is_significant
from ...services.slack_verify import verify_slack_signature

router = APIRouter()
logger = logging.getLogger(__name__)


def _slack_update_kwargs() -> dict:
    """Resolve apply / governance for Slack ingestion from settings (no API key validation)."""
    from ...config import load_settings

    s = load_settings(validate=False)
    if s.slack_governance:
        return {"apply": True, "require_approval": True}
    return {"apply": s.slack_apply_updates, "require_approval": False}


def _log_slack_http_response(payload: dict) -> None:
    """Log the JSON body Slack (or curl) sees — look for challenge, queued, or skipped."""
    if "challenge" in payload:
        ch = payload.get("challenge")
        n = len(ch) if isinstance(ch, str) else 0
        logger.info("slack /slack/events response: url_verification (challenge length=%s)", n)
        return
    if payload.get("queued") is True:
        logger.info("slack /slack/events response: %s", payload)
        return
    if "skipped" in payload:
        logger.info("slack /slack/events response: %s", payload)
        return
    logger.info("slack /slack/events response: %s", payload)


def _build_source(event: dict, team_id: str = "", channel: str = "") -> dict:
    """Build the ``source`` dict the reconciler expects for Slack messages."""
    return {
        "kind": "slack",
        "url": f"slack://{team_id}/{channel}/{event.get('ts', '')}",
        "channel": channel,
        "user": event.get("user", ""),
        "ts": event.get("ts", ""),
        "team": team_id,
    }


def _process_slack_event(text: str, event: dict, team_id: str) -> None:
    """Run reconciliation in the background after 200ing Slack.

    Slack's Events API retries any request that doesn't get a 2xx within
    3 seconds. The deterministic reconciler can take 3-5s on cold start
    (BGE encoder load, retrieval, reconcile), which would trigger duplicate
    deliveries. We acknowledge instantly and do the work here.
    """
    source = _build_source(event, team_id=team_id, channel=event.get("channel", ""))
    kw = _slack_update_kwargs()
    try:
        out = agent_runner.update(
            text,
            update_mode="deterministic",
            source=source,
            **kw,
        )
    except Exception as exc:  # noqa: BLE001 - background task must not raise
        logger.exception("background reconcile failed: %s", exc)
        return
    plan = out.get("plan")
    op_count = len(plan.operations) if hasattr(plan, "operations") else 0
    logger.info(
        "slack background ingest: ops=%s applied=%s status=%s kwargs=%s",
        op_count,
        out.get("applied"),
        out.get("status"),
        kw,
    )


@router.post("/slack/events")
async def slack_events(request: Request, background_tasks: BackgroundTasks):
    """Slack Events API webhook.

    Handles:
    - URL verification challenge (one-time when configuring Event Subscriptions)
    - ``message.channels`` events (queued for async ingestion so we always
      ack Slack within its 3-second timeout and avoid retry-driven duplicates)
    """
    body = await request.body()
    timestamp = request.headers.get("x-slack-request-timestamp", "")
    signature = request.headers.get("x-slack-signature", "")

    if not verify_slack_signature(body, timestamp, signature):
        logger.warning("Slack signature verification failed")
        raise HTTPException(status_code=401, detail="bad signature")

    payload = await request.json()

    # 1. URL verification handshake (Slack does this once when you configure the URL).
    if payload.get("type") == "url_verification":
        body = {"challenge": payload.get("challenge", "")}
        _log_slack_http_response(body)
        return body

    # 2. Real event.
    if payload.get("type") == "event_callback":
        event = payload.get("event", {}) or {}
        team_id = payload.get("team_id", "")

        # Ignore bot messages (including our own replies) and edits/deletes.
        if event.get("subtype") in {"bot_message", "message_changed", "message_deleted"}:
            skip_body = {"ok": True, "skipped": "non-user event"}
            _log_slack_http_response(skip_body)
            return JSONResponse(skip_body)
        if event.get("bot_id"):
            skip_body = {"ok": True, "skipped": "bot author"}
            _log_slack_http_response(skip_body)
            return JSONResponse(skip_body)

        text = (event.get("text") or "").strip()
        significant, reason = is_significant(text)

        if not significant:
            logger.info("slack message skipped: %s", reason)
            skip_body = {"ok": True, "skipped": reason}
            _log_slack_http_response(skip_body)
            return JSONResponse(skip_body)

        # Queue the heavy reconcile work; 200 to Slack instantly so its
        # 3-second retry timer never fires.
        background_tasks.add_task(
            _process_slack_event,
            text=text,
            event=event,
            team_id=team_id,
        )
        queued_body = {"ok": True, "queued": True}
        _log_slack_http_response(queued_body)
        return JSONResponse(queued_body)

    fallback = {"ok": True, "type": payload.get("type", "unknown")}
    _log_slack_http_response(fallback)
    return JSONResponse(fallback)


@router.post("/slack/command")
async def slack_command(
    token: str = Form(""),
    team_id: str = Form(""),
    channel_id: str = Form(""),
    user_id: str = Form(""),
    command: str = Form(""),
    text: str = Form(""),
    response_url: str = Form(""),
):
    """Slash command fallback. Configured at ``/brain`` in the Slack app config.

    Slack POSTs ``application/x-www-form-urlencoded`` for slash commands, NOT
    JSON. No Events API signature verification needed — slash commands have
    their own ``token`` field that you can verify against
    ``SLACK_VERIFICATION_TOKEN`` if you want extra safety, but the
    signing-secret check on the request body works the same way as Events. For
    demo simplicity we trust the request here.
    """
    if not text.strip():
        return {
            "response_type": "ephemeral",
            "text": "Usage: /brain <message to ingest>",
        }

    source = {
        "kind": "slack",
        "url": f"slack://{team_id}/{channel_id}/manual",
        "channel": channel_id,
        "user": user_id,
        "ts": "manual",
        "team": team_id,
        "via": "slash_command",
    }

    kw = _slack_update_kwargs()
    try:
        out = agent_runner.update(
            text,
            update_mode="deterministic",
            source=source,
            **kw,
        )
    except Exception as exc:  # noqa: BLE001 - surface error to user
        return {
            "response_type": "ephemeral",
            "text": f"Brain ingest failed: {str(exc)[:200]}",
        }

    plan = out.get("plan")
    op_count = len(plan.operations) if hasattr(plan, "operations") else 0
    rationale = (
        plan.rationale[:200] if hasattr(plan, "rationale") else "ingested"
    )
    applied = out.get("applied")
    status = out.get("status")
    extra = ""
    if applied is True:
        extra = " Applied to brain."
    elif applied is False and status:
        extra = f" Status: {status}."
    return {
        "response_type": "in_channel",
        "text": (
            f"🧠 Ingested into the brain. {op_count} operations proposed.{extra}\n> {rationale}"
        ),
    }
