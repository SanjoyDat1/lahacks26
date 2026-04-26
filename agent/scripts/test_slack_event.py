"""Local smoke test for ``/slack/events`` without Slack actually being involved.

Posts a synthetic ``event_callback`` payload directly to ``localhost:8000``.
Skips signature verification (works because ``verify_slack_signature`` returns
True when ``SLACK_SIGNING_SECRET`` is unset).

Usage::

    cd agent
    uv run brain-api &
    uv run python scripts/test_slack_event.py
"""

from __future__ import annotations

import json
import time

import httpx

URL = "http://localhost:8000/slack/events"


def main() -> int:
    payload = {
        "type": "event_callback",
        "team_id": "T_TEST",
        "event": {
            "type": "message",
            "channel": "C_TEST",
            "user": "U_TEST",
            "ts": str(time.time()),
            "text": (
                "Decision in today's sync: we're going with pgvector for "
                "embeddings, not Qdrant. Cost was the deciding factor."
            ),
        },
    }
    headers = {
        "Content-Type": "application/json",
        "X-Slack-Request-Timestamp": str(int(time.time())),
        "X-Slack-Signature": "v0=fake",  # accepted because no signing secret in env
    }
    resp = httpx.post(URL, content=json.dumps(payload), headers=headers, timeout=60)
    print(f"HTTP {resp.status_code}")
    print(resp.text)
    return 0 if resp.status_code == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
