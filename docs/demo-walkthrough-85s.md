# Brian — hackathon demo script (~1:25)

**Goal:** Sound human, stay credible, still drop enough real stack detail that technical judges buy it.  
**Pacing:** ~85 seconds if you move briskly; if you’re short on time, skip the bracketed *optional* sentences.

---

## How to use this

1. **Rehearse once with the URLs** at the bottom — muscle memory beats reading cold.  
2. **Don’t read file names aloud** unless you’re pointing at code; say “our Next app,” “the Python agent,” “the graph,” etc.  
3. **Technical appendix** at the end is for Q&A, not for VO unless someone asks.

---

## The story in three beats (memorize this)

1. **Ingest is live** — you’re not uploading a PDF into a black box; you’re watching a pipeline stream real stages into a real repo-shaped brain.  
2. **Knowledge is navigable** — same markdown becomes a force graph, chat with sources, and persisted links on disk.  
3. **The product has edges** — search, webhooks, audit trail, and an observability view so it’s not demo-ware.

---

## Full voiceover (~1:25)

### 0:00–0:14 · Hook + landing (`/`)

**[SCREEN]** Home / session start — empty or with repos and uploads visible.

**Say:**  
“Here’s the problem we kept hitting at hackathons: teams have docs, GitHub, Drive, Slack — but nothing turns that into **structured, linked knowledge** your agent can actually use. **Brian** fixes that. This home screen is where you start a session: you point us at **GitHub repos**, drop **files** we support, and optionally pull in **Google** context — Calendar, Drive, whatever you’ve wired up. When you hit go, we don’t fake a progress bar — we open a **WebSocket** to our agent and stream **real pipeline events** so the UI always reflects what the backend is doing.”

---

### 0:14–0:34 · The pipeline feels real (`/`)

**[SCREEN]** Stage labels moving; construction graph lighting up; file rows going planned → done.

**Say:**  
“Watch the stages — upload, normalize, distill, write, index, verify — that’s the actual bootstrap path, not animation candy. *Optional:* each stage is a typed event from the agent, so the frontend never guesses state.  
While that runs, this **construction graph** is built from the **file plan** — we layout a path tree and light up nodes and edges as the agent commits to structure. When files flip to **done**, that’s real markdown landing in the workspace — then we jump to the **brain map** so you’re not stuck in a file picker.”

**[SCREEN]** Click through to `/brain` if your recording ends this beat on completion.

---

### 0:34–0:58 · Brain map + chat (`/brain`)

**[SCREEN]** Graph, division chips, drag a link or hover edges; prompt bar; optional widen preview chevron.

**Say:**  
“This is **Brian Map** — same brain the agent just wrote, loaded over **`/api/agent/files`** so the graph always matches the Python process, not a stale copy on the web server. *Optional:* we poll when you come back to the tab so judges see live refresh.  
You can **filter by division** — engineering vs product vs finance — and the graph and file tree stay in sync. **Pan, zoom, drag between nodes** to add a link; we’re optimistic in the UI, then we persist **`links` in the YAML frontmatter** — through our API and, when the agent’s up, onto **the same files the agent serves** so nothing forks.  
Down here you **chat** against that brain: our **`/api/chat`** route prefers **streaming the connected agent**, with a fallback path if the agent’s offline — so answers are grounded in what you actually ingested, not a generic model.”

---

### 0:58–1:12 · Search, hooks, audit (fast tour)

**[SCREEN]** `/search` → one query → `/integrations` → `/events` (scroll a few items).

**Say:**  
“**Search** is semantic — plain English, scored chunks, not Ctrl-F.  
**Integrations** gives you **webhook URLs** backed by our store — wire Slack or whatever; we show status so you know if anything’s hit yet.  
**Events** is the honesty view: every inbound thing, joined with **what the AI actually wrote** to the brain — so you get an audit trail, not a magic black box.”

---

### 1:12–1:25 · Observability + humans (`/agent` → `/runtime-brain`)

**[SCREEN]** `/agent` — send or show viz + trace; then flash `/runtime-brain`.

**Say:**  
“**Agent Observatory** is for when something looks wrong: same stream the app trusts, plus a **trace** of tool calls and results — so you can see *which* tool touched *which* path.  
**Runtime brain** is the human lane on the same markdown — edit, review, ship.  
So in one stack: **ingest live**, **navigate and wire knowledge on a graph**, **ask it questions**, **hook the outside world**, **audit it**, **debug it**, **edit it** — that’s Brian.”

---

## One-line closer (if you need a hard stop)

“**Git-backed company brain, agent-native ingest, graph you can trust** — thanks.”

---

## URLs — hit in order (rehearsal cheat sheet)

| # | URL | One word |
|---|-----|------------|
| 1 | `http://localhost:3000/` | Ingest |
| 2 | `http://localhost:3000/brain` | Map |
| 3 | `http://localhost:3000/search` | Search |
| 4 | `http://localhost:3000/integrations` | Webhooks |
| 5 | `http://localhost:3000/events` | Audit |
| 6 | `http://localhost:3000/agent` | Debug |
| 7 | `http://localhost:3000/runtime-brain` | Edit |

`/start` and `/dashboard` redirect to `/` — same experience.

---

## Technical appendix (Q&A — don’t overload the VO)

| Topic | One-liner you can use if asked |
|--------|--------------------------------|
| Home UI | Next.js App Router; `SessionStartPage` client orchestrates bootstrap. |
| Stream | WebSocket bootstrap; typed `BootstrapEvent` (stages, `file_planned`, `file_created`, graph deltas). |
| Construction graph | Path tree from planned files + `layoutPathTree`; ghost batches until GitHub confirms. |
| Brain data | `GET /api/agent/files` proxies agent `GET /files`; YAML frontmatter normalized; `buildGraphData` for graph. |
| Divisions | `divisionKeyForPath` + filter chips filter sim + tree together. |
| Links | Optimistic `addGraphLink` / `removeGraphLink`; `POST`/`DELETE` `/api/brain/links` → agent `/links` when agent is up so **disk matches graph**. |
| Chat | `/api/chat` proxies `AGENT_API_URL` stream when possible; tool/path hints can light “active sources” on the graph. |
| Context rebuild | `ContextMapRebuildNotifier` + agent rebuild stream; debounced refetch of files on success. |
| Search | `GET /api/search?q=…` — embedding-backed retrieval (shape depends on your indexer). |
| Integrations | Server component + `listIntegrations()` — webhook URLs, env-based signature story. |
| Events | `listEvents` + `listBrainUpdates` correlated on `eventId`. |
| Observatory | `AgentObservatory` + streamed events; LangGraph-style viz + append-only tool log. |
| Runtime brain | SSR `readBrain` + `BrainWorkspace` — human edit path on same corpus. |

---

## Optional b-roll (only if you run long or pre-record)

- Network tab: `/api/agent/files`, `/api/brain/links`, `/api/chat` — shows “not a slide deck.”  
- Preview panel **chevron** widening — “we actually care about reading markdown.”  
- Double-click edge on graph → link removed in YAML — pairs well with the persistence story.
