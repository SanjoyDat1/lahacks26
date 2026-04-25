from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_AGENT_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_REFERENCE = _AGENT_DIR.parent / "brian"
_DEFAULT_WORKING = _AGENT_DIR.parent / "brain"


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
        env_file=(".env", str(_AGENT_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    gemini_model: str = Field(
        default="gemini-2.5-flash",
        validation_alias="GEMINI_MODEL",
    )
    gemini_include_thoughts: bool = Field(
        default=True,
        validation_alias="GEMINI_INCLUDE_THOUGHTS",
    )
    gemini_thinking_budget: int = Field(default=-1, validation_alias="GEMINI_THINKING_BUDGET")
    brian_reference_dir: Path = Field(default=_DEFAULT_REFERENCE, validation_alias="BRIAN_REFERENCE_DIR")
    brain_dir: Path = Field(default=_DEFAULT_WORKING, validation_alias="BRAIN_DIR")
    update_mode: str = Field(default="llm", validation_alias="UPDATE_MODE")

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
    if validate and not s.gemini_api_key.strip():
        raise ValueError("GEMINI_API_KEY is required in .env (see agent/.env.example)")
    if str(s.update_mode).strip().lower() not in {"llm", "deterministic"}:
        raise ValueError("UPDATE_MODE must be 'llm' or 'deterministic'")
    return s
