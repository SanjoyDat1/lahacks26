"""Slack request signature verification.

Slack signs every request to your webhook with HMAC-SHA256 using your
``SLACK_SIGNING_SECRET``. We MUST verify or anyone can POST events to our
endpoint.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time


def verify_slack_signature(
    body: bytes,
    timestamp: str,
    signature: str,
    *,
    max_age_seconds: int = 60 * 5,
) -> bool:
    """Return True if the request is a genuine Slack POST.

    Steps:
    1. Reject if timestamp is older than 5 minutes (replay defense).
    2. Compute HMAC-SHA256 of ``"v0:{timestamp}:{raw_body}"``.
    3. Compare with constant-time equality.

    Behavior in dev: when ``SLACK_SIGNING_SECRET`` is unset/empty we fail
    open so the endpoint can be exercised locally without Slack involvement.
    Production deployments MUST set the signing secret.
    """
    secret = os.environ.get("SLACK_SIGNING_SECRET", "").strip()
    if not secret:
        return True

    try:
        ts = int(timestamp)
    except (ValueError, TypeError):
        return False

    if abs(time.time() - ts) > max_age_seconds:
        return False

    base = f"v0:{timestamp}:".encode() + body
    digest = hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()
    expected = f"v0={digest}"
    return hmac.compare_digest(expected, signature)
