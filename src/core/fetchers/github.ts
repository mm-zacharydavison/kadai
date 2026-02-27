import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { GithubPluginSource } from "../../types.ts";
import type { FetchResult } from "./types.ts";

/**
 * Fetch a GitHub plugin by shallow-cloning the repo and
 * copying its contents into destDir.
 */
export async function fetchGithubPlugin(
  source: GithubPluginSource,
  destDir: string,
): Promise<FetchResult> {
  const ref = source.ref ?? "main";
  const repoUrl = `https://github.com/${source.github}.git`;

  await mkdir(destDir, { recursive: true });

  // Shallow clone into destDir
  const proc = Bun.spawn(
    ["git", "clone", "--depth", "1", "--branch", ref, repoUrl, destDir],
    { stdout: "pipe", stderr: "pipe" },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Failed to clone "${source.github}" (ref: ${ref}): ${stderr.trim()}`,
    );
  }

  // Read the commit SHA
  const shaProc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: destDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const sha = (await new Response(shaProc.stdout).text()).trim();
  await shaProc.exited;

  // Remove .git directory — we only want the content, not the repo metadata
  await rm(join(destDir, ".git"), { recursive: true, force: true });

  return { resolvedVersion: sha };
}

/**
 * Check if the remote HEAD SHA for a ref differs from currentSha.
 * Returns true if an update is available, false otherwise (including on error).
 */
export async function checkGithubUpdate(
  source: GithubPluginSource,
  currentSha: string,
): Promise<boolean> {
  try {
    const ref = source.ref ?? "main";
    const repoUrl = `https://github.com/${source.github}.git`;

    const proc = Bun.spawn(["git", "ls-remote", repoUrl, ref], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = (await new Response(proc.stdout).text()).trim();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return false;

    // Output format: "<sha>\t<ref>"
    const remoteSha = output.split("\t")[0] ?? "";
    if (!remoteSha) return false;

    return remoteSha !== currentSha;
  } catch {
    return false;
  }
}
