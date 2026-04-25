from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from ..services import agent_runner

mcp = FastMCP("Brian Brain MCP")


@mcp.tool()
def brain_query(prompt: str) -> str:
    """Read and summarize project context without changing files."""
    out = agent_runner.query(prompt)
    return str(out.get("result_text", ""))


@mcp.tool()
def brain_update(prompt: str, update_mode: str | None = None, apply: bool = True) -> str:
    """Update the working brain using the configured update mode."""
    out = agent_runner.update(prompt, update_mode=update_mode, apply=apply)
    # Keep compatibility: return text if present, else return plan JSON.
    txt = str(out.get("result_text", "") or "").strip()
    if txt:
        return txt
    plan = out.get("plan")
    if hasattr(plan, "to_dict"):
        import json

        return json.dumps(plan.to_dict(), ensure_ascii=False, indent=2)
    if isinstance(plan, dict):
        import json

        return json.dumps(plan, ensure_ascii=False, indent=2)
    return ""


def main() -> None:
    """Run the MCP server over stdio."""
    mcp.run()

