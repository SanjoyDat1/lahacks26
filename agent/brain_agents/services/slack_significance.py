"""Decide whether a Slack message is significant enough to ingest.

Conservative heuristic — better to skip noise than ingest chitchat.
Returns ``(significant: bool, reason: str)``. The reason is logged so we
can tune the heuristic post-demo.
"""

from __future__ import annotations

import re

# Words/phrases that suggest durable team knowledge, not chatter.
_SIGNIFICANT_PATTERNS = [
    r"\bdecid(ed|ing|e)\b",
    r"\bgoing with\b",
    r"\bswitch(ed|ing) (from|to)\b",
    r"\bblock(ed|er|ing)\b",
    r"\bconstraint\b",
    r"\bdeadline\b",
    r"\bmust (not |never )?\b",
    r"\brequire(d|s)?\b",
    r"\bowns?\b",
    r"\bowner\b",
    r"\bagreed\b",
    r"\bADR\b",
    r"\barchitecture\b",
    r"\bmigration\b",
]
_PATTERN_RE = re.compile("|".join(_SIGNIFICANT_PATTERNS), re.IGNORECASE)

# Hard skip — bot messages, threads about coffee, etc.
_NOISE_PATTERNS = [
    r"^:[\w+-]+:$",            # just an emoji
    r"^(hi|hey|hello|lol|haha|ok|okay|👍|👎)$",
    r"^/",                       # slash commands (handled separately)
]
_NOISE_RE = re.compile("|".join(_NOISE_PATTERNS), re.IGNORECASE)

MIN_LENGTH = 25  # below this, skip


def is_significant(text: str) -> tuple[bool, str]:
    """Return ``(is_significant, reason)`` for the given message text."""
    text_stripped = (text or "").strip()
    if len(text_stripped) < MIN_LENGTH:
        return False, f"too short ({len(text_stripped)} chars)"
    if _NOISE_RE.match(text_stripped):
        return False, "noise pattern match"
    if _PATTERN_RE.search(text_stripped):
        return True, "matched significance keyword"
    return False, "no significance signal"
