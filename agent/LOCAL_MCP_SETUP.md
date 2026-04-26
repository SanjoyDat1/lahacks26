# Brian Local MCP Setup

This project now includes a local MCP server entrypoint that exposes two tools to Codex:

- `brain_query`: reads context from the knowledge base using the Reader agent
- `brain_update`: updates the working brain using the Reader + Writer agent flow

## What The Server Uses

- Reference knowledge: `<repo>/brian` (templates / reference Markdown)
- Working copy: `<repo>/brain` (agent-writable tree)

On first run, the working `brain/` directory is bootstrapped from `brian/` if it does not already exist.

## One-Time Setup

1. Create the env file:

```bash
cd /path/to/your/clone/agent
cp .env.example .env
```

2. Edit `.env` and add your `OPENAI_API_KEY`.

3. Install dependencies:

```bash
cd /path/to/your/clone/agent
uv sync
```

## Local Smoke Test

You can verify the package loads and the command is available with:

```bash
cd /path/to/your/clone/agent
uv run brain-mcp
```

That command should start the MCP server and wait for a stdio client such as Codex.

## Register In Codex

Add the local server to Codex with:

```bash
codex mcp add brian -- uv --directory /path/to/your/clone/agent run brain-mcp
```

Then verify it:

```bash
codex mcp list
codex mcp get brian
```

If Codex is already open, restart the app after registration.

## How To Use It In Codex

Example prompts:

- `Use the brian MCP to summarize the runtime flow.`
- `Use the brian MCP to update the decision log with a note about our local MCP architecture.`
- `Ask brian which files explain the ingestion pipeline.`

## Notes

- `brian/` remains read-only reference structure.
- `brain/` is the live writable copy.
- The write path only replaces existing Markdown files under `brain/`.
