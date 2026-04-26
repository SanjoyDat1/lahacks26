"""Graph link mutations hit the same working brain as ``GET /files``."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from brain_agents.api.routes.links import router


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path):
    (tmp_path / "src_a.md").write_text(
        "---\nid: node-a\nlinks: []\nupdated: 2020-01-01\n---\n\n# A\n",
        encoding="utf-8",
    )
    (tmp_path / "src_b.md").write_text(
        "---\nid: node-b\nlinks:\n  - src_a.md\n---\n\n# B\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("BRAIN_DIR", str(tmp_path))
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_post_link_adds_frontmatter_entry(client: TestClient) -> None:
    r = client.post("/links", json={"sourceId": "node-a", "targetId": "node-b"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert "node-b" in data["result"]["links"]

    root = Path(os.environ["BRAIN_DIR"])
    raw = (root / "src_a.md").read_text(encoding="utf-8")
    assert "node-b" in raw
    assert "links:" in raw


def test_delete_link_removes_frontmatter_entry(client: TestClient) -> None:
    r = client.request(
        "DELETE",
        "/links",
        json={"sourceId": "node-b", "targetId": "node-a"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert "src_a.md" not in data["result"]["links"]

    root = Path(os.environ["BRAIN_DIR"])
    raw = (root / "src_b.md").read_text(encoding="utf-8")
    assert "src_a.md" not in raw
