from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_AGENT_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _AGENT_DIR.parent
_DEFAULT_REFERENCE = _REPO_ROOT / "brian"
_DEFAULT_WORKING = _REPO_ROOT / "brain"


def ensure_working_brain(reference: Path, working: Path) -> None:
    """
    Validate brain paths without materializing the working brain.

    The `brian/` tree is a read-only schema/example. The live working brain is
    created lazily by prompt-driven tools so startup does not pre-populate files
    the project has not proven it needs.
    """
    ref = reference.resolve()
    if not ref.is_dir():
        raise FileNotFoundError(f"Reference brain (example context) not found: {ref}")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Search order: agent/.env → repo-root .env → environment variables
        env_file=(
            str(_AGENT_DIR / ".env"),
            str(_REPO_ROOT / ".env"),
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── OpenAI ────────────────────────────────────────────────────────────────
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4o-mini", validation_alias="OPENAI_MODEL")

    # ── Shared ────────────────────────────────────────────────────────────────
    brian_reference_dir: Path = Field(default=_DEFAULT_REFERENCE, validation_alias="BRIAN_REFERENCE_DIR")
    brain_dir: Path = Field(default=_DEFAULT_WORKING, validation_alias="BRAIN_DIR")
    update_mode: str = Field(default="llm", validation_alias="UPDATE_MODE")
    retrieval_enabled: bool = Field(default=True, validation_alias="RETRIEVAL_ENABLED")
    retrieval_dense_enabled: bool = Field(default=True, validation_alias="RETRIEVAL_DENSE_ENABLED")

    # ── Slack ─────────────────────────────────────────────────────────────────
    # Empty string => fail-open in dev (no signature check). Set in production
    # to enforce HMAC-SHA256 verification on every Events API request.
    slack_signing_secret: str = Field(default="", validation_alias="SLACK_SIGNING_SECRET")
    # When true, ``/slack/events`` and ``/slack/command`` pass ``apply=True`` so
    # reconciliation mutates the working brain (deterministic mode). When false,
    # only a plan is produced (legacy plan-only Events behavior).
    slack_apply_updates: bool = Field(default=False, validation_alias="SLACK_APPLY_UPDATES")
    # When true, Slack ingests use ``require_approval=True``: high-confidence plans
    # auto-apply; others go to pending review (see ``review_pending.py``).
    # Implies apply for auto-approved plans; takes precedence over slack_apply_updates alone.
    slack_governance: bool = Field(default=False, validation_alias="SLACK_GOVERNANCE")
    # Uvicorn and process log level: debug, info, warning, error.
    brain_api_log_level: str = Field(default="info", validation_alias="BRAIN_API_LOG_LEVEL")

    @field_validator("brian_reference_dir", mode="before")
    @classmethod
    def ref_path(cls, v: Any) -> Path:
        if v in (None, ""):
            return _DEFAULT_REFERENCE
        return Path(v).expanduser()

    @field_validator("brain_dir", mode="before")
    @classmethod
    def work_path(cls, v: Any) -> Path:
        if v in (None, ""):
            return _DEFAULT_WORKING
        return Path(v).expanduser()

def load_settings(validate: bool = True) -> Settings:
    s = Settings()
    if validate:
        if not s.openai_api_key.strip():
            raise ValueError(
                "No LLM API key found. Set OPENAI_API_KEY in .env "
                "(see agent/.env.example or the root .env file)"
            )
    if str(s.update_mode).strip().lower() not in {"llm", "deterministic"}:
        raise ValueError("UPDATE_MODE must be 'llm' or 'deterministic'")
    return s
