from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from .graph import run_task


mcp = FastMCP("Brian Brain MCP")


@mcp.tool()
def brain_query(prompt: str) -> str:
    """
    Read and summarize project context from the knowledge base without changing files.

    This uses the Reader agent and prefers the working `brain/` copy when it exists.
    """
    return run_task(user=prompt, task="query")


@mcp.tool()
def brain_update(prompt: str) -> str:
    """
    Add or alter durable project context in the working knowledge base.

    This runs the Reader first to gather context, then the Writer to update existing
    Markdown files in the bootstrapped `brain/` directory. It never edits `brian/`.
    """
    return run_task(user=prompt, task="update")


def main() -> None:
    """Run the MCP server over stdio for local Codex integration."""
    mcp.run()


if __name__ == "__main__":
    main()
