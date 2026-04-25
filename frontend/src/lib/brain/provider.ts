import { Octokit } from "@octokit/rest";

import { brainPaths, defaultBrainFiles } from "@/lib/brain/defaults";
import { env, hasGitHubBrain } from "@/lib/env";
import type { BrainFile } from "@/lib/types";
import { stableId } from "@/lib/utils";

const memoryBrain = new Map(defaultBrainFiles.map((file) => [file.path, file.content]));

export async function listBrainFiles() {
  if (!hasGitHubBrain()) return [...memoryBrain.keys()].sort();
  return brainPaths;
}

export async function readBrainFile(path: string) {
  if (!hasGitHubBrain()) {
    return {
      path,
      content: memoryBrain.get(path) ?? "",
    };
  }

  const octokit = getOctokit();
  const response = await octokit.repos.getContent({
    owner: env.brainRepoOwner!,
    repo: env.brainRepoName!,
    path,
    ref: env.brainRepoBranch,
  });

  if (Array.isArray(response.data) || response.data.type !== "file") {
    throw new Error(`${path} is not a brain file`);
  }

  return {
    path,
    content: Buffer.from(response.data.content, "base64").toString("utf8"),
    sha: response.data.sha,
  } satisfies BrainFile;
}

export async function readBrain() {
  const files = await listBrainFiles();
  return Promise.all(files.map((path) => readBrainFile(path)));
}

export async function writeBrainFile(input: {
  path: string;
  content: string;
  message: string;
}) {
  if (!hasGitHubBrain()) {
    memoryBrain.set(input.path, input.content);
    return {
      sha: stableId("local_commit"),
      url: undefined,
    };
  }

  const octokit = getOctokit();
  let sha: string | undefined;

  try {
    const existing = await readBrainFile(input.path);
    sha = existing.sha;
  } catch {
    sha = undefined;
  }

  const response = await octokit.repos.createOrUpdateFileContents({
    owner: env.brainRepoOwner!,
    repo: env.brainRepoName!,
    branch: env.brainRepoBranch,
    path: input.path,
    message: input.message,
    content: Buffer.from(input.content, "utf8").toString("base64"),
    sha,
  });

  return {
    sha: response.data.commit.sha,
    url: response.data.commit.html_url,
  };
}

export async function ensureBrainDefaults() {
  const results = [];

  for (const file of defaultBrainFiles) {
    const existing = await readBrainFile(file.path).catch(() => undefined);
    if (!existing?.content) {
      results.push(
        await writeBrainFile({
          ...file,
          message: `brain: initialize ${file.path}`,
        }),
      );
    }
  }

  return results;
}

function getOctokit() {
  return new Octokit({ auth: env.githubToken });
}
