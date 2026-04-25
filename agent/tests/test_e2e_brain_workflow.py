from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock


AGENT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = AGENT_ROOT.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from brain_agents.builder import create_brain_from_documents
from brain_agents.config import Settings
from brain_agents.retrieval.encoder import BM25Encoder
from brain_agents.retrieval.reranker import KeywordReranker
from brain_agents.services import agent_runner
from brain_agents.services.retrieval_service import retrieval_service
from brain_agents.tools import BrainContext, build_all_tools
from brain_agents.update import Operation, ReconciliationPlan


DOCUMENTS_DIR = Path(__file__).resolve().parent / "documents"
BRAINS_DIR = Path(__file__).resolve().parent / "brains"


@contextmanager
def local_retrieval_dependencies():
    """Keep retrieval deterministic without replacing the brain-generation agent."""

    with ExitStack() as stack:
        stack.enter_context(mock.patch("brain_agents.retrieval.retriever._make_encoder", side_effect=lambda: BM25Encoder()))
        stack.enter_context(mock.patch("brain_agents.retrieval.retriever._make_reranker", side_effect=lambda: KeywordReranker()))
        yield


def _tool_map(ctx: BrainContext) -> dict[str, object]:
    return {tool.name: tool for tool in build_all_tools(ctx)}


def _generated_markdown(root: Path) -> str:
    chunks: list[str] = []
    for path in sorted(root.rglob("*.md")):
        if ".audit" in path.parts or ".index" in path.parts:
            continue
        chunks.append(path.read_text(encoding="utf-8", errors="replace"))
    return "\n\n".join(chunks)


def _persist_brain_snapshot(source: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    destination = BRAINS_DIR / timestamp
    BRAINS_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)
    return destination


def _is_quota_error(exc: Exception) -> bool:
    text = str(exc)
    return "RESOURCE_EXHAUSTED" in text or "429" in text or "quota" in text.lower()


class BrainWorkflowE2ETest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.brain_dir = self.tmp_path / "brain"
        self.reference_dir = REPO_ROOT / "brian"
        self.settings = Settings(
            BRIAN_REFERENCE_DIR=self.reference_dir,
            BRAIN_DIR=self.brain_dir,
            UPDATE_MODE="deterministic",
        )

    def tearDown(self) -> None:
        retrieval_service.invalidate(self.brain_dir)
        self.tmp.cleanup()

    def test_agent_generates_retrieves_and_updates_brain_from_noisy_documents(self) -> None:
        if not self.settings.gemini_api_key.strip():
            self.skipTest("GEMINI_API_KEY is required for the real brain-generation E2E test")

        source_documents = sorted(
            str(path)
            for path in DOCUMENTS_DIR.iterdir()
            if path.suffix.lower() in {".md", ".txt"}
        )

        with local_retrieval_dependencies():
            try:
                written = create_brain_from_documents(
                    source_documents,
                    settings=self.settings,
                    initial_prompt=(
                        "Build a concise LA Hacks operations brain from noisy Slack, meeting, "
                        "email, and review-note documents. Separate durable decisions, "
                        "constraints, open questions, failed attempts, and integration notes."
                    ),
                    overwrite=True,
                    max_files=8,
                )
            except Exception as exc:
                if _is_quota_error(exc):
                    self.skipTest(f"Gemini quota exhausted during live brain-generation E2E: {exc}")
                raise

            self.assertIn("index.md", written)
            self.assertGreaterEqual(len(written), 3)
            self.assertTrue((self.brain_dir / "index.md").is_file())

            generated_text = _generated_markdown(self.brain_dir)
            for expected_signal in (
                "BM25",
                "Devpost",
                "app.lahacks.dev",
                "sponsor",
                "registration",
            ):
                with self.subTest(expected_signal=expected_signal):
                    self.assertIn(expected_signal.lower(), generated_text.lower())

            tools = _tool_map(BrainContext(reference=self.reference_dir, working=self.brain_dir))
            retrieval_context = tools["semantic_search"].invoke(
                {"query": "What fallback keeps retrieval useful when BGE is unavailable?", "top_k": 4}
            )
            callback_context = tools["semantic_search"].invoke(
                {"query": "Which callback URL should stay fixed during judging?", "top_k": 4}
            )
            open_question_context = tools["get_brief"].invoke(
                {"task": "Find unresolved ownership questions around Devpost and registration kiosks.", "token_budget": 1200}
            )

            self.assertNotIn("(no relevant sections found)", retrieval_context)
            self.assertIn("bm25", retrieval_context.lower())
            self.assertIn("app.lahacks.dev", callback_context.lower())
            self.assertTrue(
                "devpost" in open_question_context.lower()
                or "registration" in open_question_context.lower()
            )

            update_result = agent_runner.update(
                "Decision: the platform team owns the Devpost export fallback. "
                "The platform team must publish export status in #founders before judging.",
                update_mode="deterministic",
                apply=True,
                source={
                    "kind": "meeting",
                    "url": "https://meetings.example.test/platform-sync",
                    "timestamp": "2026-04-25T09:00:00-07:00",
                },
                settings=self.settings,
            )

            self.assertTrue(update_result["applied"])
            self.assertGreaterEqual(update_result["applied_ops"], 1)
            self.assertTrue(update_result["files_touched"])

            updated_text = _generated_markdown(self.brain_dir)
            self.assertIn("platform team", updated_text.lower())
            self.assertIn("devpost", updated_text.lower())

            audit_log = self.brain_dir / ".audit" / "log.jsonl"
            self.assertTrue(audit_log.is_file())
            self.assertIn("reconciliation_plan", audit_log.read_text(encoding="utf-8"))

            retrieval_service.invalidate(self.brain_dir)
            post_update_context = tools["semantic_search"].invoke(
                {"query": "Who owns the Devpost export fallback after the latest update?", "top_k": 4}
            )
            self.assertIn("platform team", post_update_context.lower())
            snapshot_dir = _persist_brain_snapshot(self.brain_dir)
            print(f"Persisted generated test brain: {snapshot_dir}")

    def test_mcp_tool_handlers_delegate_to_agent_runner(self) -> None:
        from brain_agents.integrations import mcp_server

        plan = ReconciliationPlan(
            operations=[
                Operation(
                    kind="append",
                    target_file="decisions/decision_log.md",
                    target_section_id=None,
                    new_content="- Simulated MCP update.",
                    reason="E2E test fixture.",
                )
            ],
            rationale="Simulated MCP plan.",
            related_sections=["decisions/decision_log.md#mcp-surface"],
            confidence=0.8,
        )

        with mock.patch.object(
            mcp_server.agent_runner,
            "query",
            return_value={"result_text": "MCP query saw Slack launch context."},
        ) as query_mock, mock.patch.object(
            mcp_server.agent_runner,
            "update",
            return_value={"result_text": "", "plan": plan},
        ) as update_mock:
            query_response = mcp_server.brain_query("Summarize Slack blockers")
            update_response = mcp_server.brain_update(
                "Record MCP update",
                update_mode="deterministic",
                apply=False,
            )

        query_mock.assert_called_once_with("Summarize Slack blockers")
        update_mock.assert_called_once_with(
            "Record MCP update",
            update_mode="deterministic",
            apply=False,
        )
        self.assertEqual(query_response, "MCP query saw Slack launch context.")
        self.assertIn('"rationale": "Simulated MCP plan."', update_response)
        self.assertIn('"target_file": "decisions/decision_log.md"', update_response)


if __name__ == "__main__":
    unittest.main()
