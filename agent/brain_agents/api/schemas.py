from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


UpdateMode = Literal["llm", "deterministic"]


class HealthResponse(BaseModel):
    ok: bool = True
    brian_reference_dir: str
    brain_dir: str
    update_mode_default: UpdateMode


class QueryRequest(BaseModel):
    prompt: str = Field(min_length=1)


class StreamRequest(BaseModel):
    prompt: str = Field(min_length=1)
    task: Literal["query", "update"] = "query"


class QueryResponse(BaseModel):
    result_text: str


class BootstrapRequest(BaseModel):
    prompt: str = ""
    sources: list[str] = Field(default_factory=list)
    overwrite: bool = False
    max_files: int = Field(default=3, ge=1, le=50)


class BootstrapResponse(BaseModel):
    written_files: list[str]


class UpdateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    update_mode: UpdateMode | None = None
    apply: bool = True
    source: dict[str, Any] = Field(default_factory=dict)


class UpdateResponse(BaseModel):
    mode: UpdateMode
    result_text: str = ""
    applied: bool | None = None
    applied_ops: int | None = None
    files_touched: list[str] | None = None
    plan: dict[str, Any] | None = None


class RetrievalSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=50)
    token_budget: int = Field(default=2000, ge=200, le=20000)


class RetrievalBriefRequest(BaseModel):
    task: str = Field(min_length=1)
    top_k: int = Field(default=8, ge=1, le=50)
    token_budget: int = Field(default=2000, ge=200, le=20000)


class RetrievalResponse(BaseModel):
    backend_label: str
    num_sections: int
    hits: list[dict[str, Any]]


class RetrievalReloadResponse(BaseModel):
    ok: bool = True
    backend_label: str
    num_sections: int

