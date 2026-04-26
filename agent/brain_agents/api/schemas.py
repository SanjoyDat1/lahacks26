from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator
from typing_extensions import Self


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


class BootstrapDocument(BaseModel):
    name: str = Field(min_length=1)
    text: str | None = None
    content_base64: str | None = None
    mime_type: str | None = None
    size: int | None = None

    @model_validator(mode="after")
    def has_readable_payload(self) -> "BootstrapDocument":
        if (self.text and self.text.strip()) or (self.content_base64 and self.content_base64.strip()):
            return self
        raise ValueError("Each document must include text or content_base64")


class InitializeGitHubRepoSource(BaseModel):
    repo_url: str = Field(min_length=1, description="https://github.com/owner/repo")
    ref: str | None = Field(
        default=None,
        description="Optional branch, tag, or commit to checkout after clone.",
    )
    include_globs: list[str] = Field(default_factory=list)
    exclude_globs: list[str] = Field(default_factory=list)
    max_files: int = Field(default=200, ge=1, le=2_000)
    max_chars: int = Field(default=120_000, ge=1_000, le=500_000)


class BootstrapStreamRequest(BaseModel):
    prompt: str = "Build my AI brain from these documents."
    documents: list[BootstrapDocument] = Field(default_factory=list)
    github_repos: list[InitializeGitHubRepoSource] = Field(
        default_factory=list,
        description="Public GitHub repos to clone and summarize as bootstrap context.",
    )
    clone_timeout_s: int = Field(default=300, ge=30, le=3_600)
    overwrite: bool = True
    max_files: int = Field(default=18, ge=1, le=50)

    @model_validator(mode="after")
    def at_least_one_source(self) -> Self:
        if not self.documents and not self.github_repos:
            raise ValueError(
                "Provide at least one public GitHub repository URL (recommended) and/or optional uploaded documents."
            )
        return self


class UpdateStreamRequest(BaseModel):
    documents: list[BootstrapDocument] = Field(default_factory=list)
    github_repos: list[InitializeGitHubRepoSource] = Field(
        default_factory=list,
        description="Public GitHub repos to add as update context.",
    )
    clone_timeout_s: int = Field(default=300, ge=30, le=3_600)
    update_mode: UpdateMode = "llm"

    @model_validator(mode="after")
    def at_least_one_source(self) -> Self:
        if not self.documents and not self.github_repos:
            raise ValueError(
                "Provide at least one public GitHub repository URL and/or optional documents."
            )
        return self


class BootstrapResponse(BaseModel):
    written_files: list[str]


class InitializeRequest(BaseModel):
    """Initialize a working brain from text context, GitHub repositories, or both."""

    prompt: str = ""
    context: str = Field(
        default="",
        description="Single raw text context document to use during initialization.",
    )
    sources: list[str] = Field(
        default_factory=list,
        description="Raw text context documents to use during initialization.",
    )
    github_repos: list[InitializeGitHubRepoSource] = Field(default_factory=list)
    overwrite: bool = False
    max_files: int = Field(
        default=18,
        ge=1,
        le=50,
        description="Maximum number of brain Markdown files to create.",
    )
    apply: bool = True
    clone_timeout_s: int = Field(default=300, ge=30, le=3_600)


class InitializeGitHubRepoResult(BaseModel):
    owner: str
    repo: str
    normalized_url: str
    ref: str | None
    commit: str | None
    files_scanned: int
    files_included: int
    content_truncated: bool


class InitializeResponse(BaseModel):
    ok: bool = True
    mode: Literal["initialize"] = "initialize"
    result_text: str = ""
    applied: bool | None = None
    written_files: list[str] = Field(default_factory=list)
    github_repos: list[InitializeGitHubRepoResult] = Field(default_factory=list)
    content_truncated: bool = False


class UpdateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    update_mode: UpdateMode | None = None
    apply: bool = True
    source: dict[str, Any] = Field(default_factory=dict)
    require_approval: bool = Field(
        default=False,
        description=(
            "When true, plans below the governance gate's confidence × authority "
            "thresholds are queued for human review instead of being applied."
        ),
    )


class UpdateResponse(BaseModel):
    mode: UpdateMode
    result_text: str = ""
    applied: bool | None = None
    applied_ops: int | None = None
    files_touched: list[str] | None = None
    plan: dict[str, Any] | None = None
    status: str | None = Field(
        default=None,
        description=(
            "Governance status of the plan: 'applied', 'auto_approved', "
            "'pending_approval', 'approved', or 'rejected'. Null when the gate "
            "was disabled."
        ),
    )


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


class ContextMapRebuildRequest(BaseModel):
    """Request to rebuild / refresh context map after an external trigger."""

    text: str = Field(min_length=1, description="Raw text describing the external change/event.")
    source: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional metadata about the trigger (e.g. kind/url/actor).",
    )
    label: str | None = Field(
        default=None,
        description="Short label for UIs/logs (e.g. 'github-webhook').",
    )
    update_mode: UpdateMode = Field(
        default="deterministic",
        description="Prefer deterministic updates for unattended triggers.",
    )


class ContextMapRebuildResponse(BaseModel):
    ok: bool = True
    run_id: str


class ContextMapRebuildAgentRequest(BaseModel):
    """Trigger a rebuild by running the full LLM agent update flow.

    This is heavier than the deterministic reconciliation stream and is intended
    when you want 'thinking', tool calls, and writer actions.
    """

    prompt: str = Field(min_length=1, description="Instruction for the agent update flow.")
    source: dict[str, Any] = Field(default_factory=dict)
    label: str | None = None


class ContextMapRebuildAgentResponse(BaseModel):
    ok: bool = True
    run_id: str

