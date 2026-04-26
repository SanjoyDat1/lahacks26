"""Local smoke test for ``/slack/events`` without Slack actually being involved.

Posts a synthetic ``event_callback`` payload directly to ``localhost:8000``.
Skips signature verification (works because ``verify_slack_signature`` returns
True when ``SLACK_SIGNING_SECRET`` is unset).

The sample text is intentionally long (≥25 chars) and decision-related so it
passes ``slack_significance.is_significant``. Expect JSON with ``"queued": true``
(or ``"skipped": ...`` if filters reject it). Set ``SLACK_APPLY_UPDATES=1`` (and
optionally ``SLACK_GOVERNANCE=1``) to mutate the brain after the 200 response.

Usage::

    cd agent
    uv run brain-api &
    uv run python scripts/test_slack_event.py
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

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
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        URL,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Slack-Request-Timestamp": str(int(time.time())),
            "X-Slack-Signature": "v0=fake",  # accepted because no signing secret in env
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode("utf-8")
            print(f"HTTP {resp.status}")
            print(text)
            return 0 if 200 <= resp.status < 300 else 1
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}")
        print(err_body)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
