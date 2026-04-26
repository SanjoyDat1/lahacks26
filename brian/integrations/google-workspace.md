---
id: integrations.google_workspace
type: integration
title: Google Workspace Integration
status: active
importance: high
updated: '2026-04-25'
links:
  - architecture.ingestion_pipeline
  - integrations.slack
keywords:
  - Google
  - OAuth
  - Drive
  - Docs
  - Sheets
  - Calendar
  - Gmail
  - Workspace
---
# Google Workspace integration (end-to-end)

This document describes **how Google Workspace is wired in this repository**: OAuth, which Google APIs are called, how content becomes brain input, and what is **not** implemented (e.g. service accounts, background sync in the Python agent).

## 1. High-level architecture

```text
┌─────────────────┐     OAuth 2.0      ┌──────────────────────┐
│  User browser   │ ◄────────────────► │  Google OAuth + APIs │
└────────┬────────┘                    └────────────────────────┘
         │
         │  Next.js App Router (frontend/)
         ▼
┌────────────────────────────────────────────────────────────────┐
│  /api/integrations/google/*                                     │
│  • authorize  → redirect to Google                              │
│  • callback   → exchange code, set encrypted session cookie       │
│  • status     → configured? connected? email?                     │
│  • drive      → list recent Drive files (metadata)               │
│  • import     → fetch file bodies → JSON "documents"            │
│  • disconnect → clear session cookie                            │
└────────┬───────────────────────────────────────────────────────┘
         │
         │  User clicks "Run bootstrap" with merged docs
         ▼
┌────────────────────────────────────────────────────────────────┐
│  WebSocket: ws://AGENT_API_URL/bootstrap/ws                     │
│  (agent/brain_agents/api/routes/bootstrap_stream.py)            │
│  Payload: { prompt, documents: [...], github_repos: [...] }     │
└────────┬───────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│  parse_uploaded_document → SourceDocument → ingestion graph      │
│  (agent/brain_agents/services/document_parser.py)               │
└────────────────────────────────────────────────────────────────┘
```

**Important:** The **Python brain agent never talks to Google**. It only receives **already-extracted** `documents` (name, text or base64, mime type) from the browser session, same as manual file uploads. All Google access tokens stay on the **Next.js server** inside an **httpOnly cookie**.

---

## 2. Google Cloud setup (operator checklist)

### 2.1 Create or select a project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select a project (or create one).

### 2.2 Enable APIs

Enable the APIs that correspond to the scopes you request (the app requests them up front; enabling in the project avoids obscure errors):

- **Google Drive API** — file listing and export/download.
- **Google Docs API** — not always strictly required for export (Drive `files.export` is used for Docs), but enabling Docs-related services keeps parity with Console guidance.
- **Google Sheets API** — spreadsheet values.
- **Google Calendar API** — primary calendar events.
- **Gmail API** — message list + metadata (readonly snapshot).

If an API is disabled, calls typically fail with `403` or API-not-enabled messages surfaced as `Google API xxx: ...` in the UI or `502` from `/api/integrations/google/import`.

### 2.3 OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. Choose **External** (typical) or **Internal** (Google Workspace org only — fewer verification steps for internal users).
3. Fill app name, support email, and **scopes** (see §4 — the app requests a fixed bundle of readonly scopes).
4. For production / non-test users, Google may require **verification** if you use sensitive scopes; plan for that before a public launch.

### 2.4 OAuth 2.0 Client ID (Web application)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins** (if required by your setup): e.g. `http://localhost:3000`, `https://your-domain.com`.
4. **Authorized redirect URIs** — must **exactly** match what Next builds (including path and trailing slash policy):

   ```text
   {NEXT_PUBLIC_APP_URL}/api/integrations/google/callback
   ```

   Example local: `http://localhost:3000/api/integrations/google/callback`

   Mismatch produces `redirect_uri_mismatch` on Google's consent page or during token exchange.

5. Copy **Client ID** and **Client secret** into environment variables (§3).

---

## 3. Environment variables (Next.js)

Defined in `frontend/.env.example` and the **repo-root** `.env.example`. At startup, `frontend/next.config.ts` merges **only** `{repo}/.env` and `frontend/.env` via `src/lib/load-env-dot-only.ts` (not `.env.local`). The same merge runs once per server process when Google routes call `loadGoogleWorkspaceEnvFromDisk()`.

Route Handlers under `frontend/src/app/api/integrations/google/` read these at runtime.

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_APP_URL` | Strongly recommended | Public base URL for redirects and webhooks (e.g. `http://localhost:3000`). Used to build the OAuth **redirect URI** via `appBaseUrl()` + `googleRedirectUri()`. |
| `GOOGLE_CLIENT_ID` | Yes | OAuth web client ID. |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth web client secret. |
| `GOOGLE_COOKIE_SECRET` | Yes | **Minimum 16 characters.** Used as key material (scrypt) to **encrypt** tokens in the session cookie (`AES-256-GCM`). |
| `GOOGLE_REDIRECT_PATH` | No | Override callback path (default `/api/integrations/google/callback`). |
| `AGENT_API_URL` | For bootstrap | Brain agent base URL (e.g. `http://localhost:8000`) — used by the start page for WebSocket bootstrap, not for Google itself. |

**Integration is considered "configured"** only when all of the following hold (`googleIntegrationConfigured()` in `frontend/src/lib/integrations/google/config.ts`):

- `GOOGLE_CLIENT_ID` is non-empty  
- `GOOGLE_CLIENT_SECRET` is non-empty  
- `GOOGLE_COOKIE_SECRET` exists and `length >= 16`

Otherwise `/api/integrations/google/authorize` returns **501** with a JSON error and the UI shows setup required.

---

## 4. OAuth scopes (readonly Workspace)

The authorization URL and the documented scope list both request **read-only** access (`frontend/src/lib/integrations/google/oauth.ts`, `config.ts`):

| Scope | Use |
|-------|-----|
| `openid`, `email`, `profile` | Identify the user; store optional email in encrypted payload. |
| `https://www.googleapis.com/auth/drive.readonly` | List files; export Docs; download binary media. |
| `https://www.googleapis.com/auth/documents.readonly` | Requested for Docs-class files (export path uses Drive export in practice). |
| `https://www.googleapis.com/auth/spreadsheets.readonly` | Read Sheet values as TSV. |
| `https://www.googleapis.com/auth/calendar.readonly` | Primary calendar events snapshot. |
| `https://www.googleapis.com/auth/gmail.readonly` | Recent-message metadata snapshot. |

OAuth parameters:

- `access_type=offline` — allows a **refresh token** (first consent with `prompt=consent` helps ensure refresh token issuance).
- `prompt=consent` — forces consent screen so refresh tokens are more reliably returned on reconnects.
- `include_granted_scopes=true` — incremental scope grants if you change scopes later.

---

## 5. OAuth flow (step by step)

### 5.1 Start authorization

- **Route:** `GET /api/integrations/google/authorize?next=/start`
- **File:** `frontend/src/app/api/integrations/google/authorize/route.ts`

Behavior:

1. If not configured → **501** JSON error.
2. Generate cryptographically random **state** (`randomBytes(24).toString("hex")`).
3. Set short-lived httpOnly cookies:
   - `google_oauth_state` = state (CSRF protection)
   - `google_oauth_next` = safe relative path for post-login redirect (must start with `/`, not `//`)
4. Redirect user to Google’s `/o/oauth2/v2/auth` with `client_id`, `redirect_uri`, `scope`, `state`, etc.

### 5.2 Callback

- **Route:** `GET /api/integrations/google/callback?code=...&state=...`
- **File:** `frontend/src/app/api/integrations/google/callback/route.ts`

Behavior:

1. If not configured → redirect to `/start?google=unconfigured`.
2. If Google returns `error` query param → redirect to `/start?google=error&message=...`.
3. Read `code` and `state`; read expected state from cookie; **clear** state and next cookies.
4. Compare `state` to cookie; on mismatch → `invalid_state` (CSRF failure).
5. Exchange `code` for tokens via `POST https://oauth2.googleapis.com/token` (`exchangeGoogleCode` in `oauth.ts`). The **redirect_uri** passed here must **match** the authorize step exactly.
6. Optionally fetch email via `https://www.googleapis.com/oauth2/v2/userinfo`.
7. **Encrypt** `{ access_token, refresh_token?, expires_at, email? }` and set cookie `google_workspace_session` (45-day max age, httpOnly, `sameSite=lax`, `secure` in production).
8. Redirect to `{next}?google=connected`.

The start page reads `?google=connected` or `?google=error` and updates the on-screen log (`session-start-page.tsx`).

### 5.3 Token refresh

- **Function:** `ensureFreshAccessToken` in `oauth.ts`
- Before each Google API call from `workspace.ts`, if `expires_at` is within ~60 seconds of now, the server uses `refresh_token` with `grant_type=refresh_token` to obtain a new access token. If there is no refresh token and the access token is expired, the user sees an error such as **"Google session expired; connect again."**

---

## 6. Session cookie encryption

- **File:** `frontend/src/lib/integrations/google/crypto.ts`
- **Algorithm:** AES-256-GCM with random 12-byte IV and 16-byte auth tag; ciphertext is `base64url(iv || tag || ciphertext)`.
- **Key derivation:** `scrypt(secret, salt="lahacks-google-oauth-v1", keylen=32)`.

The cookie payload is **not** a JWT — it is opaque to the browser (httpOnly) and only decrypted server-side in API routes.

---

## 7. HTTP API reference (Next.js)

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| `GET` | `/api/integrations/google/authorize` | None | Redirect to Google; sets state cookies. |
| `GET` | `/api/integrations/google/callback` | Google redirects here | Validates state; exchanges code; sets session cookie. |
| `GET` | `/api/integrations/google/status` | None | `{ configured, connected, email?, expiresAt? }`. |
| `GET` | `/api/integrations/google/drive?q=` | Session cookie | Lists recent Drive files (see §8.1). |
| `POST` | `/api/integrations/google/import` | Session cookie | JSON body → returns `{ documents: ImportedDoc[] }`. |
| `POST` | `/api/integrations/google/disconnect` | None | Clears session cookie. |

Typical errors:

- **501** `not_configured` — missing env.
- **401** `not_connected` — no or invalid session cookie.
- **502** — Google API error or network failure; message often includes first 500 chars of Google’s response body.

---

## 8. What gets fetched from Google (implementation detail)

All logic is in `frontend/src/lib/integrations/google/workspace.ts`.

### 8.1 Drive file list (`listRecentDriveFiles`)

- **Endpoint:** `GET https://www.googleapis.com/drive/v3/files`
- **Query:** `trashed = false`, excludes folders; optional `name contains '...'` from user search (sanitized).
- **Order:** `modifiedTime desc`
- **Page size:** default 25 in code; API route uses 30.
- **Fields:** `files(id,name,mimeType,modifiedTime)`

### 8.2 Import selected files (`importDriveFiles`)

For each `fileId`:

1. **Metadata:** `GET .../drive/v3/files/{id}?fields=id,name,mimeType,size`
2. **Google Docs** (`application/vnd.google-apps.document`): **export** as `text/plain` via `.../files/{id}/export?mimeType=text%2Fplain`
3. **Google Sheets** (`application/vnd.google-apps.spreadsheet`): fetch first sheet title from Sheets API, then `values/{title}!A1:Z5000`, join rows as **TSV**
4. **Plain text / JSON:** `alt=media` download, UTF-8 decode
5. **PDF:** `alt=media`, store as **base64** in `content_base64` with `mime_type: application/pdf` (agent parses PDF in `document_parser.py`)
6. **Other types:** try export as `text/plain`; on failure, **skip** file

**Budget limits (session safety):**

- Per-file text truncated to **150,000** characters (with `…[truncated]`).
- Combined total budget **400,000** characters across files in one import batch (may truncate last file or stop early).

### 8.3 Spreadsheet by URL (`importSpreadsheetById`)

- Parses ID from a standard Sheets URL or accepts a raw ID string (`extractSpreadsheetIdFromUrl`).
- Same TSV extraction as above; max **200,000** chars for that single doc.

### 8.4 Calendar snapshot (`buildCalendarSnapshot`)

- **Endpoint:** `GET .../calendar/v3/calendars/primary/events`
- **Window:** `timeMin = now`, `timeMax = now + 14 days`, `singleEvents=true`, `orderBy=startTime`
- **Cap:** `maxResults` min of argument and **250** (import route passes 100).
- Output is a plain-text bullet list with title, start/end, optional description snippet.

### 8.5 Gmail snapshot (`buildGmailSnapshot`)

- Lists messages: `q=newer_than:7d&maxResults=15`
- For each message, fetches metadata + **Subject**, **From**, and **snippet** (not full body).

---

## 9. UI: Session builder flow

- **Component:** `frontend/src/components/start/session-integration-sources.tsx`
- **Parent:** `session-start-page.tsx`

User journey:

1. Click **Connect Google Workspace** → `GET /api/integrations/google/authorize?next=/start`.
2. After callback, **Refresh Drive** loads `GET /api/integrations/google/drive`.
3. User selects files, optionally pastes a Sheet URL, toggles **Calendar** / **Gmail**, clicks import.
4. `POST /api/integrations/google/import` returns `documents`; parent `appendFromIntegration` converts them to the same shape as file uploads (`UploadDoc`) and appends to `docs` state.
5. User adds GitHub repos / uploads as needed, then starts bootstrap.
6. Bootstrap opens `WebSocket` to the agent and sends `documents` array (including Google-sourced names like `[Drive] ...`) in the first JSON message — see `session-start-page.tsx` `ws.send(JSON.stringify({ prompt, documents, github_repos, ... }))`.

**Disconnect** calls `POST /api/integrations/google/disconnect` and clears local selection state.

---

## 10. Brain agent: how Google content is ingested

- **WebSocket:** `agent/brain_agents/api/routes/bootstrap_stream.py` → `_collect_bootstrap_source_documents` → `parse_uploaded_document` for each `BootstrapDocument`.
- **Parsing:** `agent/brain_agents/services/document_parser.py` — supports inline `text`, or `content_base64` for PDF/DOCX/etc., enforces `MAX_DOCUMENT_CHARS` (**120,000**) per document after extraction.
- **Types:** `agent/brain_agents/api/schemas.py` — `BootstrapDocument` requires either non-empty `text` or `content_base64`.

There is **no** `google_access_token` in the agent; **no** background Drive sync in Python; **no** `changes.list` cursor in this repo’s agent layer for Google.

Updates via **`/update/ws`** accept the same document shape (`update_stream.py`), so the same Google import pattern could be merged into an update session if the UI sends those documents (the start page focuses on bootstrap).

---

## 11. Security and privacy notes

- Tokens are **never** sent to the browser in readable form; they live in an **httpOnly** cookie encrypted with `GOOGLE_COOKIE_SECRET`.
- Use a **strong, random** cookie secret in production; rotation invalidates all sessions (users must reconnect).
- **CSRF:** OAuth `state` matches a cookie set at authorize time.
- **Transport:** `secure` cookies in production (`NODE_ENV === "production"`).
- **Scope minimization:** All requested scopes are readonly; the app does not modify Drive, Calendar, or Gmail.
- **Operational:** Anyone with `GOOGLE_CLIENT_SECRET` and `GOOGLE_COOKIE_SECRET` can impersonate the app or decrypt sessions — treat `.env` as secret.

---

## 12. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `redirect_uri_mismatch` | Redirect URI in Google Console ≠ `googleRedirectUri(NEXT_PUBLIC_APP_URL)` (path, HTTP vs HTTPS, port). |
| Authorize returns 501 | Missing client id/secret or cookie secret &lt; 16 chars. |
| `invalid_state` | Cookie blocked, dual domains (www vs non-www), or stale bookmark hitting callback without authorize. |
| Import 401 `not_connected` | Session expired or cleared; reconnect Google. |
| `Google session expired; connect again.` | No refresh token; user must reconnect (ensure `prompt=consent` / offline access). |
| Drive list empty | No recent non-folder files, or query filter too strict; API still returns `files: []`. |
| PDF import errors | Corrupt PDF or parser failure; check agent logs after bootstrap. |
| Calendar/Gmail errors | API not enabled; scope not granted; Workspace admin blocks Gmail/Calendar for OAuth apps. |

**Debugging tips:**

- Watch **Network** tab for `/api/integrations/google/import` response body.
- Temporarily log only error paths (avoid logging tokens).
- Confirm `NEXT_PUBLIC_APP_URL` matches how users open the app (especially behind a reverse proxy).

---

## 13. Out of scope in this codebase

The following are **not** implemented here (do not expect them without additional work):

- **Service accounts** or **domain-wide delegation** for server-side org-wide crawl without per-user OAuth.
- **Incremental sync** (Drive `changes.list` cursors, webhooks) inside the Python agent.
- **Writing** back to Google (all scopes are readonly).
- **Shared Drives**-specific query parameters (listing may still show some shared items depending on API behavior and permissions).

For webhook-style ingestion of other sources, see `brian/architecture/ingestion_pipeline.md` and product-specific routes under `frontend/src/app/api/ingest/`.
