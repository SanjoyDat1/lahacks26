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
from ..builder import TEXT_EXTENSIONS

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
    selected = all_text[: max(0, int(max_files))]
    included = len(selected)

    lines: list[str] = [
        f"## GitHub repository (public): {parsed.owner}/{parsed.name}",
        f"Repository URL: {parsed.html_url}",
        "",
        "Ingest the following into the project brain as durable context: high-level purpose,",
        "architecture, important modules, public APIs, configuration, dependencies, and notable decisions",
        "that can be inferred. Prefer facts supported by the excerpts below. List open questions where unclear.",
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
    additional_instructions: str = "",
    settings: Settings | None = None,
) -> dict[str, Any]:
    """
    Clone a public GitHub repository, build an update prompt, and run the normal brain update.
    """
    include_globs = list(include_globs or [])
    exclude_globs = list(exclude_globs or [])

    parsed = parse_public_github_url(repo_url)

    s = settings or load_settings(validate=True)

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

    extra = (additional_instructions or "").strip()
    prompt = body if not extra else f"{body}\n\n## Additional instructions\n{extra}\n"

    source: dict[str, Any] = {
        "kind": "github_repo",
        "repo_url": parsed.html_url,
        "clone_url": parsed.clone_url,
        "ref": (ref or "").strip() or None,
        "commit": commit,
    }

    out = agent_runner.update(
        prompt,
        update_mode=update_mode,  # type: ignore[arg-type]
        apply=apply,
        source=source,
        settings=s,
    )
    plan = out.get("plan")
    plan_dict = plan.to_dict() if hasattr(plan, "to_dict") else (plan if isinstance(plan, dict) else None)  # type: ignore[union-attr]
    return {
        "ok": True,
        "owner": parsed.owner,
        "repo": parsed.name,
        "normalized_url": parsed.html_url,
        "ref": (ref or "").strip() or None,
        "commit": commit,
        "files_scanned": scanned,
        "files_included": included,
        "content_truncated": content_trunc,
        "mode": out.get("mode", "llm"),
        "result_text": str(out.get("result_text", "")),
        "applied": out.get("applied"),
        "applied_ops": out.get("applied_ops"),
        "files_touched": out.get("files_touched"),
        "plan": plan_dict,
        "error": None,
    }


__all__ = [
    "ParsedPublicRepo",
    "parse_public_github_url",
    "iter_text_files_for_ingest",
    "build_repo_ingest_prompt",
    "ingest_public_github_repo",
]
