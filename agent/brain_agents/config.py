from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_AGENT_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_REFERENCE = _AGENT_DIR.parent / "brian"
_DEFAULT_WORKING = _AGENT_DIR.parent / "brain"


def ensure_working_brain(reference: Path, working: Path) -> None:
    """
    Materialize the on-demand working brain.

    If the working directory is missing or empty, copy the reference tree
    (the `brian/` sample) so the runtime brain matches the intended shape.
    If the working tree already has content, it is left unchanged.
    """
    ref = reference.resolve()
    wk = working.resolve()
    if not ref.is_dir():
        raise FileNotFoundError(f"Reference brain (example context) not found: {ref}")

    def is_effectively_empty(d: Path) -> bool:
        if not d.exists():
            return True
        for p in d.rglob("*"):
            if p.is_file():
                return False
        return True

    wk.parent.mkdir(parents=True, exist_ok=True)
    if is_effectively_empty(wk):
        if wk.exists():
            shutil.rmtree(wk)
        shutil.copytree(ref, wk)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", str(_AGENT_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openrouter_api_key: str = Field(default="", validation_alias="OPENROUTER_API_KEY")
    openrouter_model: str = Field(
        default="openai/gpt-4o-mini",
        validation_alias="OPENROUTER_MODEL",
    )
    brian_reference_dir: Path = Field(default=_DEFAULT_REFERENCE, validation_alias="BRIAN_REFERENCE_DIR")
    brain_dir: Path = Field(default=_DEFAULT_WORKING, validation_alias="BRAIN_DIR")
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        validation_alias="OPENROUTER_BASE_URL",
    )

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
    if validate and not s.openrouter_api_key.strip():
        raise ValueError("OPENROUTER_API_KEY is required in .env (see agent/.env.example)")
    return s
