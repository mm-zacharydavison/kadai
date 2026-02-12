import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadActions } from "../core/loader.ts";
import type { Action } from "../types.ts";
import { buildSystemPrompt } from "./prompt.ts";
import type { AIProvider } from "./provider.ts";

/** Map of filePath → mtime (ms) */
export type Snapshot = Map<string, number>;

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".sh",
  ".bash",
  ".py",
  ".js",
  ".mjs",
]);

/**
 * Take a snapshot of all action files with their modification times.
 * Ignores files starting with _ or . (matching loader.ts conventions).
 */
export async function snapshotActions(actionsDir: string): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();
  await scanForSnapshot(actionsDir, actionsDir, snapshot, 0);
  return snapshot;
}

async function scanForSnapshot(
  baseDir: string,
  currentDir: string,
  snapshot: Snapshot,
  depth: number,
): Promise<void> {
  if (depth > 3) return;

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

    const fullPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await scanForSnapshot(baseDir, fullPath, snapshot, depth + 1);
    } else if (entry.isFile()) {
      const ext = `.${entry.name.split(".").pop()}`;
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      const fileStat = await stat(fullPath);
      snapshot.set(fullPath, fileStat.mtimeMs);
    }
  }
}

/**
 * Compare current state of actionsDir against a previous snapshot.
 * Returns actions that are new or modified since the snapshot was taken.
 */
export async function detectNewActions(
  actionsDir: string,
  snapshot: Snapshot,
): Promise<Action[]> {
  const currentSnapshot = await snapshotActions(actionsDir);
  const changedPaths: string[] = [];

  for (const [filePath, mtime] of currentSnapshot) {
    const prevMtime = snapshot.get(filePath);
    if (prevMtime === undefined || mtime !== prevMtime) {
      changedPaths.push(filePath);
    }
  }

  if (changedPaths.length === 0) return [];

  // Load all actions and filter to only the changed ones
  const allActions = await loadActions(actionsDir);
  return allActions.filter((a) => changedPaths.includes(a.filePath));
}

/**
 * Full generation orchestration: build prompt → spawn provider → detect new actions.
 */
export async function generate(
  provider: AIProvider,
  xcliDir: string,
  actionsDir: string,
): Promise<Action[]> {
  const snapshot = await snapshotActions(actionsDir);
  const systemPrompt = await buildSystemPrompt(xcliDir, actionsDir);

  await provider.spawn({ xcliDir, actionsDir, systemPrompt });

  return detectNewActions(actionsDir, snapshot);
}
