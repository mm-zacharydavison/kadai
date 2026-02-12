import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Action, ActionSource, SourceConfig } from "../types.ts";
import { GitFetcher, type SourceFetcher } from "./fetcher.ts";
import { loadActions } from "./loader.ts";

/**
 * Generate the cache directory name for a source config.
 * Format: {owner}-{repo}-{ref}
 */
export function cacheSlotName(source: SourceConfig): string {
  const ref = source.ref ?? "main";
  return `${source.repo.replace("/", "-")}-${ref}`;
}

/**
 * Ensure the .cache/sources/ directory exists with a .gitignore.
 */
export async function ensureCacheDir(xcliDir: string): Promise<void> {
  const cacheDir = join(xcliDir, ".cache");
  const sourcesDir = join(cacheDir, "sources");
  await mkdir(sourcesDir, { recursive: true });

  const gitignorePath = join(cacheDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await Bun.write(gitignorePath, "*\n");
  }
}

/**
 * Load actions from cached external sources (fast, no network).
 */
export async function loadCachedSources(
  xcliDir: string,
  sources: SourceConfig[],
): Promise<Action[]> {
  const allActions: Action[] = [];

  for (const source of sources) {
    const slot = cacheSlotName(source);
    const actionsDir = join(xcliDir, ".cache", "sources", slot, "actions");

    if (!existsSync(actionsDir)) continue;

    const actionSource: ActionSource = {
      type: "github",
      label: source.repo,
    };

    const actions = await loadActions(actionsDir, actionSource);
    allActions.push(...actions);
  }

  return allActions;
}

/**
 * Background-refresh all sources, calling onUpdate when done.
 * Accepts an optional fetcher for testing (defaults to GitFetcher).
 */
export async function refreshSources(
  xcliDir: string,
  sources: SourceConfig[],
  onUpdate: (actions: Action[]) => void,
  fetcher: SourceFetcher = new GitFetcher(),
): Promise<void> {
  await ensureCacheDir(xcliDir);

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const slot = cacheSlotName(source);
      const destDir = join(xcliDir, ".cache", "sources", slot);

      await fetcher.fetch(source, destDir);
      await fetcher.writeMeta(destDir, source);
    }),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      process.stderr.write(`[xcli] Source refresh failed: ${result.reason}\n`);
    }
  }

  // Reload all cached sources and call the update callback
  const actions = await loadCachedSources(xcliDir, sources);
  onUpdate(actions);
}
