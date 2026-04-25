"""Source-authority weights shared by the retrieval and update modules.

Higher = more trustworthy / "should win" when reconciling. The values are the
LOCKED contract from the shared seat handoff and must be kept in sync between
seats. Both retrieval boosting and update conflict-resolution read from this
table.
"""

from __future__ import annotations

SOURCE_AUTHORITY: dict[str, float] = {
    "merged_pr": 1.0,
    "adr": 1.0,
    "decision_log": 0.9,
    "manual": 0.95,
    "meeting": 0.8,
    "review_comment": 0.7,
    "issue": 0.6,
    "slack": 0.5,
    "demo": 0.4,
}

DEFAULT_AUTHORITY: float = 0.5


def authority_for(source_kind: str | None) -> float:
    """Return the authority weight for a frontmatter ``source.kind``.

    Unknown or missing kinds receive :data:`DEFAULT_AUTHORITY` so that a
    section is never silently zeroed-out during ranking.
    """
    if not source_kind:
        return DEFAULT_AUTHORITY
    return SOURCE_AUTHORITY.get(source_kind.strip().lower(), DEFAULT_AUTHORITY)
