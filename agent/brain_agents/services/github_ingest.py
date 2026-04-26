"""Clone and analyze public GitHub repositories for brain updates."""

from __future__ import annotations

import fnmatch
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config import Settings, load_settings
from . import agent_runner
from ..builder import TEXT_EXTENSIONS, SourceDocument

# Directory names to skip when walking a cloned tree (lowercase).
IGNORED_DIR_NAMES = {
    ".git",
    "node_modules",
    ".next",
    "out",
    "dist",
    "build",
    ".turbo",
    "coverage",
    "venv",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "vendor",
    "bower_components",
    ".tox",
    "target",  # Rust
    ".idea",
    ".vs",
    "htmlcov",
    ".eggs",
}

_GITHUB_SSH = re.compile(r"^git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$", re.IGNORECASE)

_PER_FILE_EXCERPT = 4_000


@dataclass(frozen=True, slots=True)
class ParsedPublicRepo:
    """Normalized public GitHub HTTPS clone URL and identity."""

    owner: str
    name: str
    clone_url: str

    @property
    def html_url(self) -> str:
        return f"https://github.com/{self.owner}/{self.name}"


def parse_public_github_url(url: str) -> ParsedPublicRepo:
    """
    Parse and validate a public GitHub repository URL.

    Only ``https://github.com/{owner}/{repo}`` (optional ``.git``) is accepted.
    Rejects subpaths, non-GitHub hosts, and non-HTTP(S) forms.
    """
    raw = (url or "").strip()
    if not raw:
        raise ValueError("repo_url is required")

    if raw.startswith("git@"):
        m = _GITHUB_SSH.match(raw)
        if not m:
            raise ValueError("Invalid git@github.com URL")
        owner, name = m.group(1), m.group(2)
        name = _strip_git_suffix(name)
        if not owner or not name or "/" in name:
            raise ValueError("Invalid owner or repository name")
        return ParsedPublicRepo(
            owner=owner,
            name=name,
            clone_url=f"https://github.com/{owner}/{name}.git",
        )

    if not (raw.lower().startswith("https://") or raw.lower().startswith("http://")):
        raise ValueError("repo_url must use https://github.com/... (public repos only)")

    no_q = raw.split("?", 1)[0].strip()
    m_host = re.match(
        r"^https?://(www\.)?github\.com/(.+)$", no_q, re.IGNORECASE
    )
    if not m_host:
        raise ValueError("repo_url must be a GitHub.com repository URL")

    rest = (m_host.group(2) or "").strip().strip("/")
    parts = [p for p in rest.split("/") if p and p not in (".", "..")]
    if len(parts) < 2:
        raise ValueError("Expected https://github.com/owner/repository")
    if len(parts) > 2:
        raise ValueError("Use a repository root URL without /tree, /blob, or other subpaths")
    owner, name = parts[0], _strip_git_suffix(parts[1])
    if not owner or not name:
        raise ValueError("Invalid owner or repository name")
    for token in (owner, name):
        if ".." in token or "/" in token:
            raise ValueError("Invalid owner or repository name")

    return ParsedPublicRepo(
        owner=owner,
        name=name,
        clone_url=f"https://github.com/{owner}/{name}.git",
    )


def _strip_git_suffix(s: str) -> str:
    if s.lower().endswith(".git"):
        return s[:-4]
    return s


def _run_git(
    args: list[str],
    *,
    timeout: int,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=check,
        timeout=timeout,
        capture_output=True,
        text=True,
    )


def _clone_shallow(
    clone_url: str,
    dest: Path,
    ref: str | None,
    *,
    timeout_s: int,
) -> None:
    r = (ref or "").strip()
    if r:
        attempt = _run_git(
            [
                "git",
                "clone",
                "--depth",
                "1",
                "-b",
                r,
                "--single-branch",
                clone_url,
                str(dest),
            ],
            timeout=timeout_s,
            check=False,
        )
        if attempt.returncode == 0:
            return
        # Clone default branch shallow, then try to reach ref (tag/branch/SHA) via fetch
        _run_git(
            ["git", "clone", "--depth", "1", clone_url, str(dest)],
            timeout=timeout_s,
        )
        w = ["git", "-C", str(dest)]
        for depth in (1, 200):
            f = _run_git(
                [*w, "fetch", "--depth", str(depth), "origin", r],
                timeout=timeout_s,
                check=False,
            )
            if f.returncode == 0:
                _run_git(
                    [*w, "checkout", "FETCH_HEAD"],
                    timeout=120,
                )
                return
        _run_git(
            [*w, "fetch", "origin", r],
            timeout=timeout_s,
        )
        _run_git(
            [*w, "checkout", r],
            timeout=120,
        )
    else:
        _run_git(
            ["git", "clone", "--depth", "1", clone_url, str(dest)],
            timeout=timeout_s,
        )


def _git_head_commit(dest: Path, timeout: int) -> str | None:
    try:
        p = _run_git(
            ["git", "-C", str(dest), "rev-parse", "HEAD"],
            timeout=timeout,
        )
    except (subprocess.CalledProcessError, OSError, subprocess.TimeoutExpired):
        return None
    h = p.stdout.strip()
    return h or None


def _repo_relative_path(repo_root: Path, path: Path) -> str:
    return str(path.resolve().relative_to(repo_root.resolve())).replace("\\", "/")


def _matches_globs(relative: str, patterns: list[str], *, default_if_empty: bool) -> bool:
    if not patterns:
        return default_if_empty
    return any(fnmatch.fnmatch(relative, p) for p in patterns)


def iter_text_files_for_ingest(
    repo_root: Path,
    *,
    include_globs: list[str],
    exclude_globs: list[str],
) -> list[Path]:
    """
    List text-like files under repo_root, honoring include/exclude globs (fnmatch, POSIX paths).
    """
    root = repo_root.resolve()
    candidates: list[Path] = []

    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel = _repo_relative_path(root, p)
        part_names = {x.lower() for x in p.parts}
        if part_names & IGNORED_DIR_NAMES:
            continue
        if ".git" in p.parts:
            continue
        if p.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        if not _matches_globs(rel, include_globs, default_if_empty=True):
            continue
        if _matches_globs(rel, exclude_globs, default_if_empty=False):
            continue
        candidates.append(p)

    return sorted(candidates, key=lambda x: str(x).lower())


def _read_file_capped(path: Path, per_file: int) -> str:
    try:
        t = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    t = t.strip()
    if len(t) > per_file:
        return t[:per_file] + f"\n\n[Truncated: file > {per_file} chars]\n"
    return t


# Lockfiles and minified bundles: strong deprioritization for indexing signal.
_LOCKFILE_NAMES = frozenset(
    {
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "poetry.lock",
        "pipfile.lock",
        "bun.lockb",
        "bun.lock",
        "uv.lock",
    }
)

# Test / generated noise (path substrings, lowercased).
_NOISE_PATH_MARKERS = frozenset(
    (
        "/cypress/",
        "/e2e/",
        "/playwright/",
        "/fixtures/",
        "/mocks/",
        "/snapshots/",
        "/__snapshots__/",
        "/migrations/",
    )
)

# Path segments that suggest FastAPI, Next.js, or shared app layout.
_SEGMENT_WEIGHTS: dict[str, int] = {
    "app": 36,
    "pages": 44,
    "components": 40,
    "lib": 34,
    "hooks": 32,
    "api": 42,
    "routes": 46,
    "routers": 46,
    "server": 30,
    "services": 44,
    "src": 8,
}


def score_repo_path(relative: str) -> int:
    """
    Heuristic importance score for repository files (lightweight FastAPI, Next.js, or similar).

    Higher is more likely to contain architecture and product signal. Not ML-based;
    used only to order excerpts within ``max_files`` and ``max_chars`` budgets.
    """
    r = (relative or "").replace("\\", "/").strip()
    if not r:
        return 0
    r_lower = r.lower()
    segs = [p.lower() for p in r.split("/") if p]
    base = segs[-1] if segs else ""
    score = 0

    if base in _LOCKFILE_NAMES:
        score -= 85
    if base.endswith((".min.js", ".min.mjs", ".min.css", ".min.ts", ".min.tsx")):
        score -= 50

    if "__tests__" in segs:
        score -= 75
    if any(m in r_lower for m in _NOISE_PATH_MARKERS):
        score -= 45
    if base.startswith("test_") and base.endswith(".py"):
        score -= 65
    if base.endswith(("_test.py", "_test.ts", "_test.tsx", "_test.js", "_test.jsx")):
        score -= 65
    if ".test." in base or ".spec." in base:
        score -= 60
    if len(segs) >= 2 and segs[0] in ("tests", "test") and base.endswith(
        (".py", ".ts", ".tsx", ".js", ".jsx")
    ):
        score -= 40

    if base in ("readme.md", "readme.rst", "readme.txt", "contributing.md", "license", "license.md"):
        score += 110
    if base == "package.json":
        score += 95
    if base in ("pyproject.toml", "requirements.txt", "requirements-dev.txt", "pipfile"):
        score += 92
    if base in ("setup.py", "setup.cfg", "tox.ini"):
        score += 35
    if base == "dockerfile" or base.startswith("dockerfile."):
        score += 75
    if "docker-compose" in base or base in (".env.example", "env.example"):
        score += 60
    if base in ("vercel.json", "tsconfig.json", "jsconfig.json"):
        score += 45
    if base.startswith("next.config"):
        score += 88
    if "tailwind.config" in base or base.startswith("postcss.config"):
        score += 55
    if base in ("middleware.ts", "middleware.js"):
        score += 50

    if base in ("main.py", "app.py", "asgi.py", "wsgi.py"):
        score += 70
    if base in ("schemas.py", "models.py", "database.py", "dependencies.py", "config.py", "settings.py"):
        score += 48

    seen_seg: set[str] = set()
    for s in segs:
        if s in _SEGMENT_WEIGHTS and s not in seen_seg:
            seen_seg.add(s)
            score += _SEGMENT_WEIGHTS[s]

    return score


def select_ranked_text_files_for_ingest(
    files: list[Path],
    repo_root: Path,
    max_files: int,
) -> list[Path]:
    """
    Order candidate paths by :func:`score_repo_path`, then stable tie-breakers.

    Tie-break: higher path length first does not apply; we prefer higher score, then
    shorter relative path, then lexicographic path for reproducibility.
    """
    n = max(0, int(max_files))
    if n == 0 or not files:
        return []

    def sort_key(p: Path) -> tuple[int, int, str]:
        rel = _repo_relative_path(repo_root, p)
        s = score_repo_path(rel)
        # Prefer shorter paths on equal score (often entrypoints / top-level).
        return (-s, len(rel), rel.lower())

    ranked = sorted(files, key=sort_key)
    return ranked[:n]


def build_repo_ingest_prompt(
    parsed: ParsedPublicRepo,
    repo_root: Path,
    *,
    include_globs: list[str],
    exclude_globs: list[str],
    max_files: int,
    max_chars: int,
) -> tuple[str, int, int, int, bool]:
    """
    Build a single update prompt text from the cloned repository.

    Returns (prompt, files_scanned, files_included, char_budget_used, truncated).
    """
    all_text = iter_text_files_for_ingest(
        repo_root,
        include_globs=include_globs,
        exclude_globs=exclude_globs,
    )
    scanned = len(all_text)
    selected = select_ranked_text_files_for_ingest(
        all_text, repo_root, max(0, int(max_files))
    )
    included = len(selected)

    lines: list[str] = [
        f"## GitHub repository (public): {parsed.owner}/{parsed.name}",
        f"Repository URL: {parsed.html_url}",
        "",
        "You are ingesting **this** cloned repository as the user's project—describe what is in *this* tree.",
        "Distill the file excerpts below into durable documentation about this repo (purpose, structure, stack, entry points). Prefer facts supported by the files; note uncertainty explicitly.",
        "",
        "Extract and structure where inferable:",
        "- Project purpose and user-facing capabilities.",
        "- Runtime, frameworks, and major libraries (e.g. FastAPI, Uvicorn, Starlette, Next.js, React) from code or manifests.",
        "- Entry points: application bootstrap, API routes, server components vs client, and public HTTP surface.",
        "- Important areas: `services/`, `api/` / `routers/`, `schemas` / `models`, data access, and Next.js `app/` or `pages/`, `components/`, `lib/`, and shared hooks.",
        "- Configuration, environment, and dependencies (from README, `package.json`, `pyproject.toml`, `requirements.txt`, or similar).",
        "- Data flow and how major parts connect; client versus server boundaries in full-stack code.",
        "- Setup, build, or run notes if present in documentation or package metadata.",
        "- Open questions where the code is ambiguous, incomplete, or not shown in these excerpts.",
        "",
        "The following excerpts are ranked for relevance (not alphabetical). Use them; do not invent file paths that are not listed.",
        "",
    ]

    budget = max(0, int(max_chars) - len("\n".join(lines)))
    used = 0
    truncated = False
    for path in selected:
        rel = _repo_relative_path(repo_root, path)
        content = _read_file_capped(path, _PER_FILE_EXCERPT)
        if not content.strip():
            continue
        block = f"### File: {rel}\n\n```\n{content}\n```\n"
        if used + len(block) > budget:
            truncated = True
            break
        lines.append(block)
        used += len(block)

    body = "\n".join(lines).strip()
    if not body:
        body = f"## GitHub repository: {parsed.owner}/{parsed.name}\n\n(No text files matched filters.)"

    if len(body) > max_chars:
        body = body[: int(max_chars)] + "\n\n[Overall content truncated to max_chars.]\n"
        truncated = True

    return body, scanned, included, min(len(body), int(max_chars)), truncated


def build_public_github_repo_context(
    repo_url: str,
    *,
    ref: str | None = None,
    include_globs: list[str] | None = None,
    exclude_globs: list[str] | None = None,
    max_files: int = 200,
    max_chars: int = 120_000,
    clone_timeout_s: int = 300,
) -> dict[str, Any]:
    """Clone a public GitHub repository and return prompt-ready context plus scan metadata."""
    include_globs = list(include_globs or [])
    exclude_globs = list(exclude_globs or [])

    parsed = parse_public_github_url(repo_url)

    with tempfile.TemporaryDirectory(prefix="gh-ingest-") as tmp:
        work = Path(tmp) / "repo"
        _clone_shallow(parsed.clone_url, work, ref, timeout_s=clone_timeout_s)
        commit = _git_head_commit(work, timeout=60)
        body, scanned, included, _, content_trunc = build_repo_ingest_prompt(
            parsed,
            work,
            include_globs=include_globs,
            exclude_globs=exclude_globs,
            max_files=max_files,
            max_chars=max_chars,
        )

    return {
        "owner": parsed.owner,
        "repo": parsed.name,
        "normalized_url": parsed.html_url,
        "clone_url": parsed.clone_url,
        "ref": (ref or "").strip() or None,
        "commit": commit,
        "files_scanned": scanned,
        "files_included": included,
        "content_truncated": content_trunc,
        "context": body,
    }


def github_repo_as_source_document(
    repo_url: str,
    *,
    ref: str | None = None,
    include_globs: list[str] | None = None,
    exclude_globs: list[str] | None = None,
    max_files: int = 200,
    max_chars: int = 120_000,
    clone_timeout_s: int = 300,
) -> SourceDocument:
    """Clone a public repo and return a single ``SourceDocument`` for ingestion graphs."""
    ctx = build_public_github_repo_context(
        repo_url,
        ref=ref,
        include_globs=include_globs,
        exclude_globs=exclude_globs,
        max_files=max_files,
        max_chars=max_chars,
        clone_timeout_s=clone_timeout_s,
    )
    owner = str(ctx["owner"])
    name = str(ctx["repo"])
    label = f"github-{owner}-{name}.md"
    url = str(ctx.get("normalized_url") or "")
    return SourceDocument(name=label, text=str(ctx["context"]), source_path=url or None)


def ingest_public_github_repo(
    repo_url: str,
    *,
    ref: str | None = None,
    include_globs: list[str] | None = None,
    exclude_globs: list[str] | None = None,
    max_files: int = 200,
    max_chars: int = 120_000,
    clone_timeout_s: int = 300,
    update_mode: str | None = None,
    apply: bool = True,
    overwrite: bool = False,
    brain_max_files: int = 8,
    additional_instructions: str = "",
    settings: Settings | None = None,
) -> dict[str, Any]:
    """
    Clone a public GitHub repository, build an ingest prompt, and initialize the working brain.
    """
    include_globs = list(include_globs or [])
    exclude_globs = list(exclude_globs or [])

    s = settings or load_settings(validate=True)
    # Keep GitHub initialization free of dense retrieval side effects if later
    # graph steps are reused; initialize itself does not need retrieval.
    s = s.model_copy(update={"retrieval_dense_enabled": False})

    repo_context = build_public_github_repo_context(
        repo_url,
        ref=ref,
        include_globs=include_globs,
        exclude_globs=exclude_globs,
        max_files=max_files,
        max_chars=max_chars,
        clone_timeout_s=clone_timeout_s,
    )
    body = str(repo_context["context"])
    extra = (additional_instructions or "").strip()
    prompt = body if not extra else f"{body}\n\n## Additional instructions\n{extra}\n"

    if apply:
        out = agent_runner.bootstrap(
            prompt,
            [prompt],
            overwrite=overwrite,
            max_files=brain_max_files,
            settings=s,
        )
        written_files = list(out.get("written_files", []))
        result_text = str(out.get("result_text", ""))
        applied: bool | None = True
    else:
        written_files = []
        result_text = "GitHub repository analyzed; initialization skipped because apply=false."
        applied = None

    return {
        "ok": True,
        "owner": repo_context["owner"],
        "repo": repo_context["repo"],
        "normalized_url": repo_context["normalized_url"],
        "ref": (ref or "").strip() or None,
        "commit": repo_context["commit"],
        "files_scanned": repo_context["files_scanned"],
        "files_included": repo_context["files_included"],
        "content_truncated": repo_context["content_truncated"],
        "mode": "initialize",
        "result_text": result_text,
        "applied": applied,
        "applied_ops": len(written_files) if applied else None,
        "files_touched": written_files if applied else None,
        "written_files": written_files,
        "plan": None,
        "error": None,
    }


__all__ = [
    "ParsedPublicRepo",
    "parse_public_github_url",
    "iter_text_files_for_ingest",
    "score_repo_path",
    "select_ranked_text_files_for_ingest",
    "build_repo_ingest_prompt",
    "build_public_github_repo_context",
    "github_repo_as_source_document",
    "ingest_public_github_repo",
]
