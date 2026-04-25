from __future__ import annotations

import argparse
from pathlib import Path
from tempfile import TemporaryDirectory

from brain_agents.builder import create_brain_from_documents
from brain_agents.config import ensure_working_brain, load_settings
from brain_agents.graph import run_task
from brain_agents.tools import BrainContext, build_all_tools


def _print_section(title: str, body: str) -> None:
    print(f"\n== {title} ==")
    print(body)


def run_smoke_test() -> None:
    """Exercise the filesystem tools without requiring an LLM or API key."""

    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        reference = root / "brian"
        working = root / "brain"
        sample_file = reference / "notes" / "hello.md"

        sample_file.parent.mkdir(parents=True)
        sample_file.write_text(
            "---\ntitle: Hello\nstatus: draft\n---\nBrain agent smoke test.\n",
            encoding="utf-8",
        )

        ensure_working_brain(reference, working)

        tools = {
            tool.name: tool
            for tool in build_all_tools(BrainContext(reference=reference, working=working))
        }

        _print_section("Reference Files", tools["list_reference_brain"].invoke({}))
        _print_section(
            "Create",
            tools["upsert_working_file"].invoke(
                {
                    "relative_path": "notes/hello.md",
                    "new_content": "---\ntitle: Hello\nstatus: draft\n---\nBrain agent smoke test.\n",
                }
            ),
        )
        _print_section(
            "Working Search",
            tools["search_working_brain"].invoke({"needle": "smoke"}),
        )
        _print_section(
            "Frontmatter",
            tools["get_working_frontmatter"].invoke({"relative_path": "notes/hello.md"}),
        )
        _print_section(
            "Write",
            tools["replace_working_file"].invoke(
                {
                    "relative_path": "notes/hello.md",
                    "new_content": "---\ntitle: Changed\n---\nUpdated by smoke test.\n",
                }
            ),
        )
        _print_section(
            "Updated File",
            tools["read_working_file"].invoke({"relative_path": "notes/hello.md"}),
        )


def _is_quota_error(exc: Exception) -> bool:
    text = str(exc)
    return "RESOURCE_EXHAUSTED" in text or "429" in text or "quota" in text.lower()


def bootstrap_working_brain(
    prompt: str,
    sources: list[str],
    overwrite: bool = False,
    max_files: int = 3,
) -> None:
    """Create a minimal working brain from an initial prompt and source files."""

    settings = load_settings(validate=True)
    documents = sources or [prompt]
    try:
        written = create_brain_from_documents(
            documents,
            settings=settings,
            initial_prompt=prompt,
            overwrite=overwrite,
            max_files=max_files,
        )
    except Exception as exc:
        if _is_quota_error(exc):
            raise SystemExit(
                "OpenAI quota was exhausted while bootstrapping. The model call failed "
                "before files were generated. Check OPENAI_MODEL and OPENAI_API_KEY "
                "billing/quota."
            ) from exc
        raise
    if not written:
        print("No working brain files were needed for the provided prompt and sources.")
        return
    print(f"Working brain initialized at: {settings.brain_dir}")
    for path in written:
        print(f"- {path}")


def run_agent_task(task: str, prompt: str) -> None:
    print(run_task(prompt, task))  # type: ignore[arg-type]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run and test the brain agent.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser(
        "smoke",
        help="Run a local tool smoke test without an API key.",
    )
    bootstrap = subparsers.add_parser(
        "bootstrap",
        help="Create only the working brain files needed for an initial prompt and sources.",
    )
    bootstrap.add_argument("prompt", help="Initial prompt describing what the brain needs to capture.")
    bootstrap.add_argument(
        "sources",
        nargs="*",
        help="Source files or directories to distill into the working brain. Uses the prompt as source text if omitted.",
    )
    bootstrap.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace an existing working brain instead of refusing to write over it.",
    )
    bootstrap.add_argument(
        "--max-files",
        type=int,
        default=3,
        help="Maximum number of brain files to create during bootstrap.",
    )

    query = subparsers.add_parser("query", help="Ask the reader agent a question.")
    query.add_argument("prompt", help="Question to ask the agent.")

    update = subparsers.add_parser("update", help="Ask the writer agent to update the working brain.")
    update.add_argument("prompt", help="Update request for the agent.")

    return parser


def main() -> None:
    args = build_parser().parse_args()

    if args.command == "smoke":
        run_smoke_test()
    elif args.command == "bootstrap":
        bootstrap_working_brain(
            args.prompt,
            args.sources,
            overwrite=args.overwrite,
            max_files=args.max_files,
        )
    elif args.command == "query":
        run_agent_task("query", args.prompt)
    elif args.command == "update":
        run_agent_task("update", args.prompt)


if __name__ == "__main__":
    main()
