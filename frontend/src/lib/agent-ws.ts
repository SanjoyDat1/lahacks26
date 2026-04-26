export function resolveAgentWsUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  const envBase = process.env.NEXT_PUBLIC_AGENT_WS_URL?.trim();
  if (envBase) {
    try {
      const u = new URL(envBase);
      u.pathname = normalizedPath;
      return u.toString();
    } catch {
      // Fall through to hostname-based default.
    }
  }

  if (typeof window === "undefined") {
    // Best-effort server fallback for logs/SSR.
    return `ws://localhost:8000${normalizedPath}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.hostname}:8000${normalizedPath}`;
}

