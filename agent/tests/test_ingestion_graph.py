from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

AGENT_ROOT = Path(__file__).resolve().parents[1]
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from brain_agents.builder import SourceDocument
from brain_agents.config import Settings
from brain_agents.ingestion_graph import (
    _after_distill_router,
    _normalize_node,
    get_ingestion_workflow,
    run_update,
)
from brain_agents.ingestion_state import IngestionState
from brain_agents.update import ReconciliationPlan, Operation


class IngestionGraphUnitTest(unittest.TestCase):
    def test_after_distill_router(self) -> None:
        s: IngestionState = {"flow_mode": "initialize"}  # type: ignore[typeddict-item]
        self.assertEqual(_after_distill_router(s), "init")
        s2: IngestionState = {"flow_mode": "update"}  # type: ignore[typeddict-item]
        self.assertEqual(_after_distill_router(s2), "update")

    def test_normalize_update_empty_prompt(self) -> None:
        s = Settings(BRIAN_REFERENCE_DIR=AGENT_ROOT.parent / "brian", BRAIN_DIR=Path("/nonexistent-brain-xyz"))  # noqa: S108
        st: IngestionState = {  # type: ignore[typeddict-item]
            "flow_mode": "update",
            "settings": s,
            "update_prompt": "   ",
        }
        out = _normalize_node(st)
        self.assertIn("error", out)
        self.assertIn("result_text", out)

    def test_normalize_update_single_doc(self) -> None:
        s = Settings(BRIAN_REFERENCE_DIR=AGENT_ROOT.parent / "brian", BRAIN_DIR=Path("/x"))  # noqa: S108
        st: IngestionState = {  # type: ignore[typeddict-item]
            "flow_mode": "update",
            "settings": s,
            "update_prompt": "Decision: team A owns the API.",
        }
        out = _normalize_node(st)
        self.assertEqual(out.get("error"), None)
        docs = out.get("normalized_docs", [])
        self.assertEqual(len(docs), 1)
        self.assertIsInstance(docs[0], SourceDocument)

    def test_get_ingestion_workflow_compiles(self) -> None:
        wf = get_ingestion_workflow()
        self.assertIsNotNone(wf)

    @mock.patch("brain_agents.ingestion_graph.get_ingestion_workflow")
    def test_run_update_apply_false(self, mock_giw: mock.MagicMock) -> None:
        plan = ReconciliationPlan(
            operations=[
                Operation(
                    kind="ignore",
                    target_file="x.md",
                    target_section_id=None,
                    new_content="",
                    reason="test",
                )
            ],
            rationale="r",
            related_sections=[],
            confidence=0.5,
        )
        mock_giw.return_value.invoke.return_value = {
            "result_text": "summary",
            "plan": plan,
            "applied_result_ops": 0,
            "applied_files": [],
        }
        s = Settings(
            BRIAN_REFERENCE_DIR=AGENT_ROOT.parent / "brian",
            BRAIN_DIR=Path("/nonexistent-work-brain-apply-false"),  # noqa: S108
        )
        out = run_update(
            "Some update text for testing.",
            source={"kind": "meeting"},
            update_mode="deterministic",
            apply=False,
            settings=s,
        )
        self.assertEqual(out.get("mode"), "deterministic")
        self.assertIsNotNone(out.get("plan"))
        self.assertIsNone(out.get("applied"))
        self.assertIsNone(out.get("applied_ops"))
        self.assertIsNone(out.get("files_touched"))

    @mock.patch("brain_agents.ingestion_graph.get_ingestion_workflow")
    def test_run_update_apply_true_no_brain_dir(self, mock_giw: mock.MagicMock) -> None:
        plan = ReconciliationPlan(operations=[], rationale="noop", related_sections=[], confidence=0.0)
        mock_giw.return_value.invoke.return_value = {
            "result_text": "t",
            "plan": plan,
            "applied_result_ops": 0,
            "applied_files": [],
        }
        s = Settings(
            BRIAN_REFERENCE_DIR=AGENT_ROOT.parent / "brian",
            BRAIN_DIR=Path("/definitely-missing-brain-12345"),  # noqa: S108
        )
        out = run_update(
            "x",
            source={},
            update_mode="deterministic",
            apply=True,
            settings=s,
        )
        self.assertEqual(out.get("applied"), False)
        self.assertEqual(out.get("applied_ops"), 0)
        self.assertEqual(out.get("files_touched"), [])

    @mock.patch("brain_agents.ingestion_graph.get_ingestion_workflow")
    def test_run_update_apply_true_with_brain(self, mock_giw: mock.MagicMock) -> None:
        plan = ReconciliationPlan(operations=[], rationale="x", related_sections=[], confidence=0.0)
        mock_giw.return_value.invoke.return_value = {
            "result_text": "OK",
            "plan": plan,
            "applied_result_ops": 2,
            "applied_files": ["a.md", "b.md"],
        }
        s = Settings(
            BRIAN_REFERENCE_DIR=AGENT_ROOT.parent / "brian",
            BRAIN_DIR=AGENT_ROOT / "tests",  # existing dir
        )
        out = run_update(
            "text",
            source={},
            update_mode="deterministic",
            apply=True,
            settings=s,
        )
        self.assertEqual(out.get("applied"), True)
        self.assertEqual(out.get("applied_ops"), 2)
        self.assertEqual(out.get("files_touched"), ["a.md", "b.md"])


if __name__ == "__main__":
    unittest.main()
