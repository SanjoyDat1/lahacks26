/**
 * `localhost` often resolves to IPv6 (`::1`) while uvicorn may only listen on IPv4,
 * so the browser WebSocket fails with “connection refused”. Force IPv4 loopback.
 */
export function normalizeBootstrapWsUrlForBrowser(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
      return u.href;
    }
  } catch {
    /* ignore */
  }
  return wsUrl;
}

/**
 * Build the browser WebSocket URL for bootstrap. Used from API routes (server)
 * so `AGENT_API_URL` can drive the client when `NEXT_PUBLIC_*` is unset (local dev).
 */
export function getBootstrapWebSocketUrlForClient(): string | undefined {
  const explicit = process.env.NEXT_PUBLIC_AGENT_WS_URL?.trim();
  if (explicit) return normalizeBootstrapWsUrlForBrowser(explicit);

  const pub = process.env.NEXT_PUBLIC_AGENT_API_URL?.trim().replace(/\/+$/, "");
  if (pub) {
    try {
      const u = new URL(pub);
      const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
      return normalizeBootstrapWsUrlForBrowser(`${wsProto}//${u.host}/bootstrap/ws`);
    } catch {
      /* ignore */
    }
  }

  const agent = (process.env.AGENT_API_URL ?? "http://localhost:8000").trim();
  try {
    const u = new URL(agent);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
      return normalizeBootstrapWsUrlForBrowser(`${wsProto}//${u.host}/bootstrap/ws`);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
