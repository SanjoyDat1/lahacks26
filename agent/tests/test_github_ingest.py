from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

AGENT_ROOT = Path(__file__).resolve().parents[1]
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from brain_agents.api.routes.bootstrap import initialize  # noqa: E402
from brain_agents.api.routes.github import github_ingest  # noqa: E402
from brain_agents.api.schemas import GitHubRepoIngestRequest, InitializeRequest  # noqa: E402
from brain_agents.config import Settings  # noqa: E402
from brain_agents.services.github_ingest import (  # noqa: E402
    build_repo_ingest_prompt,
    ingest_public_github_repo,
    iter_text_files_for_ingest,
    parse_public_github_url,
    score_repo_path,
    select_ranked_text_files_for_ingest,
)


class ParsePublicGitHubUrlTest(unittest.TestCase):
    def test_https_root(self) -> None:
        p = parse_public_github_url("https://github.com/microsoft/TypeScript")
        self.assertEqual(p.owner, "microsoft")
        self.assertEqual(p.name, "TypeScript")
        self.assertEqual(p.clone_url, "https://github.com/microsoft/TypeScript.git")

    def test_https_with_git_suffix(self) -> None:
        p = parse_public_github_url("https://github.com/foo/bar.git")
        self.assertEqual(p.owner, "foo")
        self.assertEqual(p.name, "bar")

    def test_strip_query(self) -> None:
        p = parse_public_github_url("https://github.com/foo/bar?tab=readme-ov-file")
        self.assertEqual(p.name, "bar")

    def test_reject_subpath(self) -> None:
        with self.assertRaises(ValueError):
            parse_public_github_url("https://github.com/foo/bar/tree/main/src")

    def test_reject_non_github(self) -> None:
        with self.assertRaises(ValueError):
            parse_public_github_url("https://gitlab.com/foo/bar")

    def test_ssh_form(self) -> None:
        p = parse_public_github_url("git@github.com:org/repo.git")
        self.assertEqual(p.owner, "org")
        self.assertEqual(p.name, "repo")


class IterTextFilesTest(unittest.TestCase):
    def test_respects_include_exclude_and_ignores(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / "node_modules" / "x").mkdir(parents=True)
            (root / "node_modules" / "x" / "a.js").write_text("a", encoding="utf-8")
            (root / "src").mkdir(parents=True)
            (root / "src" / "app.py").write_text("print(1)", encoding="utf-8")
            (root / "src" / "skip.txt").write_text("no", encoding="utf-8")
            (root / "README.md").write_text("# hi", encoding="utf-8")

            all_f = iter_text_files_for_ingest(root, include_globs=[], exclude_globs=[])
            rels = {str(p.relative_to(root)).replace("\\", "/") for p in all_f}
            self.assertNotIn("node_modules/x/a.js", rels)
            self.assertIn("src/app.py", rels)
            self.assertIn("README.md", rels)

            only_src = iter_text_files_for_ingest(
                root,
                include_globs=["src/*"],
                exclude_globs=[],
            )
            self.assertEqual(
                {str(p.relative_to(root)).replace("\\", "/") for p in only_src},
                {"src/app.py", "src/skip.txt"},
            )

            ex = iter_text_files_for_ingest(
                root,
                include_globs=[],
                exclude_globs=["src/skip.txt"],
            )
            rels_ex = {str(p.relative_to(root)).replace("\\", "/") for p in ex}
            self.assertNotIn("src/skip.txt", rels_ex)


class ScoreRepoPathTest(unittest.TestCase):
    def test_readme_outranks_lockfile(self) -> None:
        self.assertGreater(
            score_repo_path("README.md"),
            score_repo_path("yarn.lock"),
        )

    def test_package_json_outranks_lockfile(self) -> None:
        self.assertGreater(
            score_repo_path("package.json"),
            score_repo_path("package-lock.json"),
        )

    def test_fastapi_route_beats_bare_module(self) -> None:
        self.assertGreater(
            score_repo_path("src/routers/users.py"),
            score_repo_path("src/utils/helpers.py"),
        )

    def test_next_app_page_beats_loose_file(self) -> None:
        self.assertGreater(
            score_repo_path("app/page.tsx"),
            score_repo_path("notes.txt"),
        )

    def test_test_file_deprioritized(self) -> None:
        self.assertGreater(
            score_repo_path("src/api/handler.py"),
            score_repo_path("tests/test_handler.py"),
        )

    def test_select_ranked_prefers_highest_scores(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            f_z = root / "zzz_low.txt"
            f_r = root / "README.md"
            f_z.write_text("z", encoding="utf-8")
            f_r.write_text("# r", encoding="utf-8")
            out = select_ranked_text_files_for_ingest([f_z, f_r], root, max_files=1)
            self.assertEqual(len(out), 1)
            self.assertEqual(out[0].name, "README.md")


class BuildRepoIngestPromptTest(unittest.TestCase):
    def test_truncates_to_max_chars(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.py").write_text("x" * 20_000, encoding="utf-8")
            p = parse_public_github_url("https://github.com/o/r")
            body, scanned, included, _, trunc = build_repo_ingest_prompt(
                p,
                root,
                include_globs=[],
                exclude_globs=[],
                max_files=5,
                max_chars=5_000,
            )
            self.assertLessEqual(len(body), 5_500)
            self.assertTrue(trunc or len(body) <= 5_000 + 200)

    def test_uses_ranking_not_alphabetical_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "aaa_noise.txt").write_text("aaa", encoding="utf-8")
            (root / "README.md").write_text("# hi", encoding="utf-8")
            (root / "package.json").write_text("{}", encoding="utf-8")
            p = parse_public_github_url("https://github.com/o/r")
            body, scanned, included, _, _ = build_repo_ingest_prompt(
                p,
                root,
                include_globs=[],
                exclude_globs=[],
                max_files=1,
                max_chars=50_000,
            )
            self.assertEqual(scanned, 3)
            self.assertEqual(included, 1)
            self.assertIn("README.md", body)
            self.assertNotIn("aaa_noise", body)


class IngestPublicGithubRepoTest(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(
            BRIAN_REFERENCE_DIR=AGENT_ROOT.parent / "brian",
            BRAIN_DIR=Path("/nonexistent-github-ingest-brain"),  # noqa: S108
            UPDATE_MODE="deterministic",
        )

    @mock.patch("brain_agents.services.github_ingest._clone_shallow")
    @mock.patch("brain_agents.services.github_ingest.agent_runner.bootstrap")
    def test_delegates_to_agent_initialize(
        self, mock_bootstrap: mock.MagicMock, mock_clone: mock.MagicMock
    ) -> None:
        mock_bootstrap.return_value = {
            "written_files": ["index.md"],
            "result_text": "Initialized working brain.",
        }

        def fake_clone(
            _url: str, dest: Path, _ref: str | None, *, timeout_s: int
        ) -> None:
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "hi.py").write_text("x = 1", encoding="utf-8")

        mock_clone.side_effect = fake_clone

        out = ingest_public_github_repo(
            "https://github.com/some/thing",
            settings=self.settings,
            apply=True,
        )

        self.assertTrue(out["ok"])
        self.assertEqual(out["owner"], "some")
        self.assertEqual(out["repo"], "thing")
        self.assertEqual(out["mode"], "initialize")
        self.assertEqual(out["written_files"], ["index.md"])
        self.assertEqual(out["files_touched"], ["index.md"])
        passed_settings = mock_bootstrap.call_args.kwargs.get("settings")
        self.assertFalse(passed_settings.retrieval_dense_enabled)
        self.assertEqual(mock_bootstrap.call_args.kwargs.get("max_files"), 8)
        prompt = mock_bootstrap.call_args[0][0]
        self.assertIn("## GitHub repository (public): some/thing", prompt)
        self.assertIn("hi.py", prompt)


class GithubRouteTest(unittest.TestCase):
    @mock.patch("brain_agents.api.routes.github.ingest_public_github_repo")
    def test_route_propagates_validation(self, mock_ingest: mock.MagicMock) -> None:
        from fastapi import HTTPException

        mock_ingest.side_effect = ValueError("bad")
        with self.assertRaises(HTTPException) as ctx:
            github_ingest(GitHubRepoIngestRequest(repo_url="https://github.com/a/b"))
        self.assertEqual(ctx.exception.status_code, 400)

    @mock.patch("brain_agents.api.routes.github.ingest_public_github_repo")
    def test_route_success(self, mock_ingest: mock.MagicMock) -> None:
        mock_ingest.return_value = {
            "ok": True,
            "owner": "a",
            "repo": "b",
            "normalized_url": "https://github.com/a/b",
            "ref": None,
            "commit": "abc",
            "files_scanned": 1,
            "files_included": 1,
            "content_truncated": False,
            "mode": "initialize",
            "result_text": "done",
            "applied": True,
            "applied_ops": 1,
            "files_touched": ["x.md"],
            "written_files": ["x.md"],
            "plan": None,
            "error": None,
        }
        r = github_ingest(GitHubRepoIngestRequest(repo_url="https://github.com/a/b"))
        self.assertEqual(r.owner, "a")
        self.assertEqual(r.result_text, "done")
        self.assertEqual(r.written_files, ["x.md"])


class InitializeRouteTest(unittest.TestCase):
    @mock.patch("brain_agents.api.routes.bootstrap.agent_runner.bootstrap")
    def test_initialize_accepts_text_context(
        self, mock_bootstrap: mock.MagicMock
    ) -> None:
        mock_bootstrap.return_value = {
            "written_files": ["index.md", "summaries/project_summary.md"],
            "result_text": "Initialized working brain.",
        }

        r = initialize(
            InitializeRequest(
                prompt="Build a brain",
                context="This should be first.",
                sources=["The app is a Next.js landing page."],
                max_files=4,
            )
        )

        self.assertTrue(r.applied)
        self.assertEqual(r.written_files, ["index.md", "summaries/project_summary.md"])
        self.assertEqual(mock_bootstrap.call_args[0][0], "Build a brain")
        self.assertEqual(
            mock_bootstrap.call_args[0][1],
            ["This should be first.", "The app is a Next.js landing page."],
        )
        self.assertEqual(mock_bootstrap.call_args.kwargs["max_files"], 4)

    @mock.patch("brain_agents.api.routes.bootstrap.agent_runner.bootstrap")
    @mock.patch("brain_agents.api.routes.bootstrap.build_public_github_repo_context")
    def test_initialize_accepts_github_repo_context(
        self, mock_context: mock.MagicMock, mock_bootstrap: mock.MagicMock
    ) -> None:
        mock_context.return_value = {
            "owner": "a",
            "repo": "b",
            "normalized_url": "https://github.com/a/b",
            "clone_url": "https://github.com/a/b.git",
            "ref": None,
            "commit": "abc",
            "files_scanned": 2,
            "files_included": 1,
            "content_truncated": False,
            "context": "repo context",
        }
        mock_bootstrap.return_value = {
            "written_files": ["index.md"],
            "result_text": "done",
        }

        r = initialize(
            InitializeRequest(
                prompt="Build repo brain",
                github_repos=[{"repo_url": "https://github.com/a/b"}],
                overwrite=True,
            )
        )

        self.assertTrue(r.applied)
        self.assertEqual(r.github_repos[0].normalized_url, "https://github.com/a/b")
        self.assertEqual(mock_bootstrap.call_args[0][1], ["repo context"])
        self.assertTrue(mock_bootstrap.call_args.kwargs["overwrite"])


if __name__ == "__main__":
    unittest.main()
