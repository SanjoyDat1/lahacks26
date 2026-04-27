# Brian

Brian bridges human project context and LLM coding agents. It ingests engineering signals, stores searchable context, distills durable decisions into Markdown, and exposes that project memory through a web app, an agent API, and a local MCP server.

This repository is a monorepo with a Next.js frontend, a Python agent service, and a Git-backed Markdown "brain" for shared project knowledge.

## Repository Layout

```text
frontend/   Next.js app, UI, API routes, integrations, and Drizzle database code
agent/      Python brain-agents package, FastAPI app, MCP server, retrieval, and update flows
brian/      Tracked reference knowledge base and architecture docs
brain/      Runtime writable knowledge base, generated locally and gitignored
docs/       Demo and walkthrough docs
```

On first run, the agent can bootstrap the writable `brain/` directory from the tracked `brian/` reference tree.

## Prerequisites

- Node.js and npm
- Python 3.11+
- `uv` for Python dependency management
- Optional: Postgres with `pgvector` for production persistence
- Optional: OpenAI, GitHub, Google Workspace, Slack, and webhook credentials for live integrations

The app can run locally without most credentials. In that mode, it uses deterministic fallbacks and local/in-memory behavior for demos.

## Environment

Start from the example files and fill in only the integrations you need:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
cp agent/.env.example agent/.env
```

Important variables include:

- `NEXT_PUBLIC_APP_URL` for the frontend URL, usually `http://localhost:3000`
- `AGENT_API_URL` and `NEXT_PUBLIC_AGENT_API_URL` for the Python agent API, usually `http://localhost:8000`
- `OPENAI_API_KEY`, `OPENAI_MODEL`, and `OPENAI_EMBEDDING_MODEL` for LLM and embedding calls
- `DATABASE_URL` for Postgres persistence
- `GITHUB_TOKEN`, `BRAIN_REPO_OWNER`, `BRAIN_REPO_NAME`, and `BRAIN_REPO_BRANCH` for Git-backed brain storage
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_COOKIE_SECRET` for Google Workspace imports
- `GITHUB_WEBHOOK_SECRET`, `GITLAB_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`, `DISCORD_WEBHOOK_SECRET`, and `MEETINGS_WEBHOOK_SECRET` for webhook verification

The frontend intentionally reads `.env` files from the repo root and `frontend/.env`. Prefer those over `.env.local` for local setup.

## Local Development

Install and run the agent API:

```bash
cd agent
uv sync
uv run brain-api
```

In another terminal, install and run the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The agent API defaults to [http://localhost:8000](http://localhost:8000).

From `frontend/`, you can also start the agent API with:

```bash
npm run brain-api
```

## Common Commands

Frontend commands:

```bash
cd frontend
npm run dev
npm run lint
npm run typecheck
npm run build
npm run db:generate
npm run db:push
```

Agent commands:

```bash
cd agent
uv sync
uv run brain-api
uv run brain-mcp
```

## Local MCP Server

The Python package includes a local MCP server that exposes Brian's project memory to compatible coding agents:

- `brain_query` reads context from the knowledge base.
- `brain_update` proposes updates to the writable brain.

Run it locally with:

```bash
cd agent
uv run brain-mcp
```

See `agent/LOCAL_MCP_SETUP.md` for registration instructions and smoke tests.

## Webhook Endpoints

The frontend includes webhook-shaped ingestion endpoints for common engineering sources:

- `POST /api/ingest/github`
- `POST /api/ingest/gitlab`
- `POST /api/ingest/slack`
- `POST /api/ingest/discord`
- `POST /api/ingest/meetings`

If a matching secret is configured, the endpoint verifies incoming requests. If the secret is omitted, endpoints are easier to smoke test locally.

## Production Notes

For a production deployment:

1. Create a Postgres database with the `vector` extension enabled.
2. Set `DATABASE_URL` and run `npm run db:push` or generate migrations with `npm run db:generate`.
3. Set `OPENAI_API_KEY` for real embeddings and distillation.
4. Configure Git-backed brain storage with a GitHub token and brain repository settings.
5. Set webhook secrets for every external source you enable.
6. Deploy the frontend to Vercel or another Next.js host.
7. Run the Python agent API somewhere reachable by the frontend and browser WebSocket clients.

## Further Reading

- `frontend/README.md` for web app details and API smoke tests
- `agent/LOCAL_MCP_SETUP.md` for local MCP setup
- `agent/brain_agents/retrieval/README.md` for retrieval internals
- `agent/brain_agents/update/README.md` for update and reconciliation internals
- `brian/architecture/` for system architecture docs
- `brian/integrations/` for integration notes
- `brian/decisions/` for architecture decision records
- `docs/demo-walkthrough-85s.md` for the demo walkthrough
