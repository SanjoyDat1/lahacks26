from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


UpdateMode = Literal["llm", "deterministic"]
GitHubIngestMode = Literal["initialize", "llm", "deterministic"]


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


class GitHubRepoIngestRequest(BaseModel):
    """Initialize a working brain from a public GitHub repository."""

    repo_url: str = Field(min_length=1, description="https://github.com/owner/repo")
    ref: str | None = Field(
        default=None,
        description="Optional branch, tag, or commit to checkout after clone.",
    )
    include_globs: list[str] = Field(
        default_factory=list,
        description="If non-empty, only include repo-relative paths matching any of these (fnmatch).",
    )
    exclude_globs: list[str] = Field(
        default_factory=list,
        description="Exclude repo-relative paths matching any of these (fnmatch).",
    )
    max_files: int = Field(
        default=200,
        ge=1,
        le=2_000,
        description="Maximum number of text files to read and attach excerpts from.",
    )
    max_chars: int = Field(
        default=120_000,
        ge=1_000,
        le=500_000,
        description="Total character budget for the synthesized update prompt.",
    )
    clone_timeout_s: int = Field(
        default=300,
        ge=30,
        le=3_600,
        description="Subprocess timeout for git clone/fetch in seconds.",
    )
    update_mode: UpdateMode | None = None
    apply: bool = True
    overwrite: bool = False
    brain_max_files: int = Field(
        default=8,
        ge=1,
        le=50,
        description="Maximum number of brain Markdown files to create during initialization.",
    )
    # Optional extra user instructions merged into the update prompt
    additional_instructions: str = Field(
        default="",
        description="Optional text appended to the synthesized repository summary for initialization.",
    )


class GitHubRepoIngestResponse(BaseModel):
    """Result of ingesting a public GitHub repository into the brain."""

    ok: bool = True
    owner: str
    repo: str
    normalized_url: str
    ref: str | None
    commit: str | None
    files_scanned: int
    files_included: int
    content_truncated: bool
    mode: GitHubIngestMode
    result_text: str = ""
    applied: bool | None = None
    applied_ops: int | None = None
    files_touched: list[str] | None = None
    written_files: list[str] | None = None
    plan: dict[str, Any] | None = None
    error: str | None = None


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

