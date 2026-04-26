const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  /** Same host the browser should use for `brain-api` (bootstrap WebSocket). Set in `.env` for tunnels / non-default ports. */
  agentApiUrlPublic: (process.env.NEXT_PUBLIC_AGENT_API_URL ?? "").replace(/\/+$/, ""),
  databaseUrl,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  githubToken: process.env.GITHUB_TOKEN,
  brainRepoOwner: process.env.BRAIN_REPO_OWNER,
  brainRepoName: process.env.BRAIN_REPO_NAME,
  brainRepoBranch: process.env.BRAIN_REPO_BRANCH ?? "main",
  webhookSecretGithub: process.env.GITHUB_WEBHOOK_SECRET,
  webhookSecretGitlab: process.env.GITLAB_WEBHOOK_SECRET,
  webhookSecretSlack: process.env.SLACK_SIGNING_SECRET,
  webhookSecretDiscord: process.env.DISCORD_WEBHOOK_SECRET,
  webhookSecretMeetings: process.env.MEETINGS_WEBHOOK_SECRET,
};

export function hasDatabase() {
  return Boolean(env.databaseUrl);
}

export function hasGitHubBrain() {
  return Boolean(env.githubToken && env.brainRepoOwner && env.brainRepoName);
}

function normalizeDatabaseUrl(value?: string) {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    const isExampleUrl =
      url.hostname === "host" ||
      url.username === "user" ||
      url.password === "password";

    return isExampleUrl ? undefined : value;
  } catch {
    return undefined;
  }
}
