from __future__ import annotations

import subprocess

from fastapi import APIRouter, HTTPException

from ...services import agent_runner
from ...services.github_ingest import build_public_github_repo_context
from ..schemas import BootstrapRequest, BootstrapResponse, InitializeRequest, InitializeResponse

router = APIRouter()


@router.post("/bootstrap", response_model=BootstrapResponse)
def bootstrap(req: BootstrapRequest) -> BootstrapResponse:
    out = agent_runner.bootstrap(
        req.prompt,
        req.sources,
        overwrite=req.overwrite,
        max_files=req.max_files,
    )
    return BootstrapResponse(written_files=list(out.get("written_files", [])))


@router.post("/initialize", response_model=InitializeResponse)
def initialize(req: InitializeRequest) -> InitializeResponse:
    """Initialize a working brain from text context and/or public GitHub repos."""
    if not req.apply:
        return InitializeResponse(
            applied=None,
            result_text="Initialization skipped because apply=false.",
        )

    documents = [req.context] if req.context.strip() else []
    documents.extend(s for s in req.sources if s.strip())
    repo_results: list[dict] = []

    try:
        for repo in req.github_repos:
            ctx = build_public_github_repo_context(
                repo.repo_url,
                ref=repo.ref,
                include_globs=repo.include_globs,
                exclude_globs=repo.exclude_globs,
                max_files=repo.max_files,
                max_chars=repo.max_chars,
                clone_timeout_s=req.clone_timeout_s,
            )
            documents.append(str(ctx["context"]))
            repo_results.append({k: v for k, v in ctx.items() if k != "context" and k != "clone_url"})

        prompt = (req.prompt or "").strip()
        if not prompt:
            prompt = "Initialize a project brain from the supplied context."
        if not documents:
            documents = [prompt]

        out = agent_runner.bootstrap(
            prompt,
            documents,
            overwrite=req.overwrite,
            max_files=req.max_files,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"Git operation timed out: {exc}") from exc
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or exc.stdout or str(exc)).strip()
        raise HTTPException(status_code=502, detail=f"Git failed: {err[:2000]}") from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Initialization failed: {exc}") from exc

    return InitializeResponse(
        applied=True,
        written_files=list(out.get("written_files", [])),
        result_text=str(out.get("result_text", "")),
        github_repos=repo_results,  # type: ignore[arg-type]
        content_truncated=any(bool(r.get("content_truncated")) for r in repo_results),
    )

