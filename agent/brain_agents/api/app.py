from __future__ import annotations

from fastapi import FastAPI

from .routes import bootstrap, health, query, retrieval, update


def create_app() -> FastAPI:
    app = FastAPI(title="Brain Agents API", version="0.1.0")
    app.include_router(health.router)
    app.include_router(query.router)
    app.include_router(update.router)
    app.include_router(bootstrap.router)
    app.include_router(retrieval.router)
    return app


app = create_app()


def main() -> None:
    """Console entrypoint for `brain-api`."""
    import uvicorn

    uvicorn.run("brain_agents.api.app:app", host="0.0.0.0", port=8000, reload=False)

