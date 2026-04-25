/** Matches backend `github_repo_as_source_document` naming: `github-{owner}-{repo}.md`. */
export function githubIngestFilename(url: string): string {
  const m = url.trim().match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!m) return "github-repo.md";
  const repo = m[2].replace(/\.git$/i, "");
  return `github-${m[1]}-${repo}.md`;
}

export type GithubRepoFormRow = { id: string; url: string; ref: string };

export function githubReposForApi(rows: GithubRepoFormRow[]) {
  return rows
    .map((r) => ({
      repo_url: r.url.trim(),
      ref: r.ref.trim() || undefined,
    }))
    .filter((r) => r.repo_url.length > 0);
}
