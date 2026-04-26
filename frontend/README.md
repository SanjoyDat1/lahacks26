# Brian (web app)

Brian bridges human project context and LLM coding agents. It ingests engineering signals from webhooks, embeds raw context for search, distills durable decisions into Markdown, and commits shared knowledge to GitHub.

## What Is Included

- Next.js App Router product UI ready for Vercel.
- Real webhook-shaped endpoints for GitHub, GitLab, Slack, Discord, and meeting transcripts.
- Drizzle Postgres schema for events, documents, integrations, and brain updates.
- pgvector-ready semantic search with deterministic local fallback.
- OpenAI-backed context distiller with no-key heuristic fallback.
- GitHub-backed brain file read/write/commit provider with local in-memory fallback.
- Brian editor, event stream, integration setup page, semantic search, and launch dashboard.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

The app runs without credentials for demos. In that mode, events, documents, and brain files live in memory until the server restarts.

Open [http://localhost:3000](http://localhost:3000), then click `Seed demo events` to exercise ingestion, distillation, search, and the Brian update flow.

## Production Setup

1. Create a Postgres database with the `vector` extension enabled.
2. Set `DATABASE_URL` in Vercel.
3. Create a GitHub token with access to the knowledge repository contents.
4. Set `GITHUB_TOKEN`, `BRAIN_REPO_OWNER`, `BRAIN_REPO_NAME`, and `BRAIN_REPO_BRANCH`.
5. Set `OPENAI_API_KEY` for real embeddings and LLM distillation.
6. Set webhook secrets for any external source you enable.
7. Run `npm run db:push` against the production database or generate migrations with `npm run db:generate`.
8. Deploy to Vercel.

## Webhook Endpoints

- `POST /api/ingest/github`
- `POST /api/ingest/gitlab`
- `POST /api/ingest/slack`
- `POST /api/ingest/discord`
- `POST /api/ingest/meetings`

If the matching secret env var is set, the endpoint verifies the request. If it is omitted, the endpoint accepts requests for demos and local testing.

## Contract For Coding Agents

Coding agents should read the Markdown files under `brain/` before writing code. Durable design choices should be appended to `brain/decision_log.md` first, so human intent and agent execution stay aligned through Git history.

## Useful Commands

```bash
npm run lint
npm run typecheck
npm run build
npm run db:generate
npm run db:push
```

## API Smoke Tests

```bash
curl -X POST http://localhost:3000/api/ingest/github \
  -H "content-type: application/json" \
  -d '{"action":"opened","repository":{"full_name":"team/app"},"issue":{"id":1,"title":"Use pgvector","body":"Architecture decision: use Postgres pgvector for semantic search."},"sender":{"login":"founder"}}'

curl "http://localhost:3000/api/search?q=pgvector"
```

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)

## Deploy on Vercel

Use the [Vercel Platform](https://vercel.com/new) and see [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying).
