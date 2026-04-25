"""Convert raw incoming text into a list of atomic ``Fact`` objects.

Two implementations sit behind one entry point :func:`extract_facts`:

1. **LLM mode.** Builds a chat model via
   :func:`agent.brain_agents.llm.make_chat_model`, sends the prompt at
   ``prompts/extract.md``, and asks for strict JSON. Validated with a small
   schema check; falls back to heuristic on any error.
2. **Heuristic mode.** Sentence-splits the input and classifies each sentence
   with a keyword table. Always available offline; this is the contract that
   makes ADR-0002 (local-demo fallbacks) hold for the update side.

Auto-selection: if no API key is configured (``OPENROUTER_API_KEY`` empty) or
``make_chat_model`` raises, we fall back to heuristic. The caller can also
force a mode via ``mode="llm" | "heuristic" | "auto"``.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Literal

logger = logging.getLogger(__name__)

_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "extract.md"

FactType = Literal[
    "Decision",
    "Constraint",
    "OpenQuestion",
    "FailedAttempt",
    "Convention",
]

_VALID_TYPES: set[str] = {
    "Decision",
    "Constraint",
    "OpenQuestion",
    "FailedAttempt",
    "Convention",
}


@dataclass
class Fact:
    """One atomic, durable claim extracted from incoming context."""

    type: FactType
    content: str
    entities: list[str] = field(default_factory=list)
    confidence: float = 0.0
    evidence_quote: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "content": self.content,
            "entities": list(self.entities),
            "confidence": self.confidence,
            "evidence_quote": self.evidence_quote,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Fact":
        t = d.get("type")
        if t not in _VALID_TYPES:
            raise ValueError(f"Invalid fact type: {t!r}")
        return cls(
            type=t,  # type: ignore[arg-type]
            content=str(d.get("content", "")).strip(),
            entities=[str(e).strip().lower() for e in d.get("entities", []) if str(e).strip()],
            confidence=float(d.get("confidence", 0.0)),
            evidence_quote=str(d.get("evidence_quote", "")).strip(),
        )


# ---------------------------------------------------------------------------
# Heuristic implementation
# ---------------------------------------------------------------------------

# Order matters: the first table whose pattern fires assigns the fact type.
# Each entry is (regex, fact_type, base_confidence). Multi-keyword bumps go on
# top of base_confidence (capped at 0.9 -- heuristics never claim certainty).
_HEURISTIC_RULES: list[tuple[re.Pattern[str], FactType, float]] = [
    (re.compile(r"\b(decision\s*[:\-]|decided|chose|going with|we'?ll go with|switching|switch(?:ed)?(?:\s+[\w\-]+){0,4}?\s+(?:from|to)|opt(?:ed|ing) for|adopt(?:ed|ing)?)\b", re.I), "Decision", 0.6),
    (re.compile(r"\b(must not|cannot|can'?t|never|always|required|requirement|deadline|sla)\b", re.I), "Constraint", 0.65),
    (re.compile(r"\b(must|need(?:s|ed)?(?:\s+to)?|has to|have to|kept (?:until|by)|until Q[1-4]|by Q[1-4])\b", re.I), "Constraint", 0.6),
    (re.compile(r"\b(tbd|unclear|not sure|don'?t know|undecided|open question)\b", re.I), "OpenQuestion", 0.6),
    (re.compile(r"\b(tried|didn'?t work|broke|broken|reverted|rolled back|abandoned|gave up on)\b", re.I), "FailedAttempt", 0.6),
    (re.compile(r"\b(we use|convention|as a rule|standard practice|we always|by convention)\b", re.I), "Convention", 0.6),
]

# Strong "Decision" signals -- when these match we both bump confidence and
# bias toward Decision over Constraint when both fire.
_STRONG_DECISION = re.compile(
    r"\b(decision\s*[:\-]|decided|going with|chose|switch(?:ed|ing)?(?:\s+[\w\-]+){0,4}?\s+(?:from|to))\b",
    re.I,
)

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9])|\n+")

# Conservative entity grabber: capitalized phrases, hyphenated identifiers,
# CamelCase, ALL_CAPS, simple file/path tokens.
_ENTITY_PATTERNS = [
    re.compile(r"\b([A-Z][a-zA-Z0-9]+(?:[-_/.][A-Za-z0-9]+)+)\b"),  # user-service, src/foo.ts
    re.compile(r"\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b"),              # user-service (lower-cased)
    re.compile(r"\b([A-Z]{2,}(?:-[A-Z0-9]+)*)\b"),                   # REST, gRPC, ADR-0001
    re.compile(r"\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b"),                # CamelCase
    re.compile(r"\b(Q[1-4])\b"),
]

# Common English words that survive the patterns above; drop them.
_ENTITY_STOPWORDS = {
    "we", "the", "this", "that", "today", "tomorrow", "decision", "team",
    "must", "should", "always", "never", "i", "you", "they",
}


def _split_sentences(text: str) -> list[str]:
    """Coarse sentence splitter that also breaks on newlines."""
    cleaned = text.replace("\r\n", "\n").strip()
    if not cleaned:
        return []
    parts = _SENTENCE_SPLIT.split(cleaned)
    return [p.strip(" \t-*•") for p in parts if p.strip(" \t-*•")]


def _extract_entities(sentence: str) -> list[str]:
    found: list[str] = []
    for pat in _ENTITY_PATTERNS:
        for m in pat.findall(sentence):
            tok = m.strip().lower()
            if tok and tok not in _ENTITY_STOPWORDS and tok not in found:
                found.append(tok)
    return found[:6]


def _classify_sentence(sentence: str) -> tuple[FactType, float] | None:
    """Return (type, confidence) for a single sentence, or None if unclassified."""
    if sentence.endswith("?"):
        return "OpenQuestion", 0.65

    matched: list[tuple[FactType, float]] = []
    for pattern, ftype, base in _HEURISTIC_RULES:
        if pattern.search(sentence):
            matched.append((ftype, base))

    if not matched:
        return None

    # If a strong decision marker fired, bias toward Decision.
    if _STRONG_DECISION.search(sentence):
        for i, (ft, conf) in enumerate(matched):
            if ft == "Decision":
                bumped = min(0.85, conf + 0.1 * (len(matched) - 1))
                return "Decision", bumped
        # Strong decision marker but no Decision in matched (rare): force it.
        return "Decision", 0.75

    primary_type, primary_conf = matched[0]
    if len(matched) > 1:
        primary_conf = min(0.85, primary_conf + 0.15)
    return primary_type, primary_conf


def _heuristic_extract(text: str) -> list[Fact]:
    facts: list[Fact] = []
    for sentence in _split_sentences(text):
        clf = _classify_sentence(sentence)
        if clf is None:
            continue
        ftype, conf = clf
        # Trim trailing punctuation but keep readable.
        clean = re.sub(r"\s+", " ", sentence).strip()
        if not clean:
            continue
        facts.append(
            Fact(
                type=ftype,
                content=clean,
                entities=_extract_entities(clean),
                confidence=conf,
                evidence_quote=clean[:200],
            )
        )
    return facts


# ---------------------------------------------------------------------------
# LLM implementation
# ---------------------------------------------------------------------------


def _load_prompt() -> str:
    try:
        return _PROMPT_PATH.read_text(encoding="utf-8")
    except OSError:  # prompt file missing -- caller should fall back
        logger.warning("extract.md prompt missing at %s", _PROMPT_PATH)
        return ""


def _build_chat_model() -> Any | None:
    """Try to instantiate the shared chat model. Returns ``None`` on any failure."""
    try:
        from ..config import load_settings
        from ..llm import make_chat_model
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("LLM imports unavailable: %s", exc)
        return None
    try:
        settings = load_settings(validate=False)
        if not (settings.gemini_api_key or "").strip():
            return None
        return make_chat_model(settings)
    except Exception as exc:
        logger.debug("Could not build chat model: %s", exc)
        return None


def _strip_json_fence(text: str) -> str:
    """Some models wrap JSON in ```json fences -- peel them off if present."""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
        if t.endswith("```"):
            t = t[: -3]
    return t.strip()


def _llm_extract(text: str, source: dict[str, Any]) -> list[Fact] | None:
    prompt = _load_prompt()
    if not prompt:
        return None
    model = _build_chat_model()
    if model is None:
        return None

    src_kind = source.get("kind", "unknown")
    src_url = source.get("url", "")
    src_ts = source.get("timestamp", "")

    user_msg = (
        f"Source kind: {src_kind}\n"
        f"Source url: {src_url}\n"
        f"Source timestamp: {src_ts}\n\n"
        "Input text:\n"
        f"{text}\n\n"
        "Return ONLY the JSON object described in the system prompt."
    )

    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        resp = model.invoke([SystemMessage(content=prompt), HumanMessage(content=user_msg)])
        content = resp.content if hasattr(resp, "content") else str(resp)
        if isinstance(content, list):
            content = "".join(
                str(part.get("text", part)) if isinstance(part, dict) else str(part)
                for part in content
            )
        data = json.loads(_strip_json_fence(str(content)))
    except Exception as exc:
        logger.warning("LLM extractor failed (%s); falling back to heuristic", exc)
        return None

    raw_facts: Iterable[Any] = data.get("facts", []) if isinstance(data, dict) else []
    out: list[Fact] = []
    for item in raw_facts:
        if not isinstance(item, dict):
            continue
        try:
            out.append(Fact.from_dict(item))
        except (ValueError, TypeError) as exc:
            logger.debug("Dropping invalid LLM fact: %s", exc)
    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

ExtractMode = Literal["auto", "llm", "heuristic"]


def extract_facts(
    text: str,
    source: dict[str, Any] | None = None,
    *,
    mode: ExtractMode = "auto",
) -> list[Fact]:
    """Return atomic facts extracted from ``text``.

    Parameters
    ----------
    text
        The raw incoming context. May span multiple sentences.
    source
        Source metadata dict with at least ``kind`` (e.g. ``"meeting"``),
        optionally ``url`` and ``timestamp``. Forwarded to the LLM prompt.
    mode
        - ``"auto"`` (default): try LLM, fall back to heuristic on any failure.
        - ``"llm"``: use LLM only; if it fails or is unavailable, return ``[]``.
        - ``"heuristic"``: use the keyword classifier; never calls the LLM.

    The function never raises on extraction failure; it returns an empty list
    instead. That keeps the reconciler resilient in the demo path.
    """
    src = source or {}
    if not text or not text.strip():
        return []

    if mode == "heuristic":
        return _heuristic_extract(text)

    if mode == "llm":
        return _llm_extract(text, src) or []

    facts = _llm_extract(text, src)
    if facts:
        return facts
    return _heuristic_extract(text)


__all__ = ["Fact", "FactType", "ExtractMode", "extract_facts"]
