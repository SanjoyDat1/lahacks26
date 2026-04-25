from __future__ import annotations

import subprocess

from fastapi import APIRouter, HTTPException

from ...services.github_ingest import ingest_public_github_repo
from ..schemas import GitHubRepoIngestRequest, GitHubRepoIngestResponse

router = APIRouter()


@router.post("/github/ingest", response_model=GitHubRepoIngestResponse)
def github_ingest(req: GitHubRepoIngestRequest) -> GitHubRepoIngestResponse:
    """Clone a public GitHub repository, analyze text files, and update the working brain."""
    try:
        out = ingest_public_github_repo(
            req.repo_url,
            ref=req.ref,
            include_globs=req.include_globs,
            exclude_globs=req.exclude_globs,
            max_files=req.max_files,
            max_chars=req.max_chars,
            clone_timeout_s=req.clone_timeout_s,
            update_mode=req.update_mode,
            apply=req.apply,
            additional_instructions=req.additional_instructions,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=504,
            detail=f"Git operation timed out: {exc}",
        ) from exc
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or exc.stdout or str(exc)).strip()
        raise HTTPException(
            status_code=502,
            detail=f"Git failed: {err[:2000]}",
        ) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Repository ingest failed: {exc}",
        ) from exc

    return GitHubRepoIngestResponse(
        ok=bool(out.get("ok", True)),
        owner=str(out["owner"]),
        repo=str(out["repo"]),
        normalized_url=str(out["normalized_url"]),
        ref=out.get("ref"),
        commit=out.get("commit"),
        files_scanned=int(out.get("files_scanned", 0)),
        files_included=int(out.get("files_included", 0)),
        content_truncated=bool(out.get("content_truncated", False)),
        mode=out.get("mode", "llm"),  # type: ignore[arg-type]
        result_text=str(out.get("result_text", "")),
        applied=out.get("applied"),
        applied_ops=out.get("applied_ops"),
        files_touched=out.get("files_touched"),
        plan=out.get("plan"),
        error=out.get("error"),
    )
