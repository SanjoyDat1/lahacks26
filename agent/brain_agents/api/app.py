from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import (
    bootstrap,
    bootstrap_stream,
    compat,
    context_rebuild,
    files,
    github,
    health,
    query,
    retrieval,
    slack,
    stream,
    update,
    update_stream,
)


def create_app() -> FastAPI:
    app = FastAPI(title="Brain Agents API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(compat.router)
    app.include_router(health.router)
    app.include_router(files.router)
    app.include_router(query.router)
    app.include_router(update.router)
    app.include_router(github.router)
    app.include_router(slack.router)
    app.include_router(bootstrap.router)
    app.include_router(bootstrap_stream.router)
    app.include_router(retrieval.router)
    app.include_router(stream.router)
    app.include_router(update_stream.router)
    app.include_router(context_rebuild.router)
    return app


app = create_app()


def main() -> None:
    """Console entrypoint for `brain-api`."""
    import logging

    import uvicorn

    from ..config import load_settings

    s = load_settings(validate=False)
    level_name = str(s.brain_api_log_level or "info").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(levelname)s [%(name)s] %(message)s",
        force=True,
    )
    logging.getLogger("brain_agents").setLevel(level)

    uvicorn.run(
        "brain_agents.api.app:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level=level_name.lower(),
    )
