import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Action, ActionOrigin, Runtime } from "../types.ts";
import { extractMetadata } from "./metadata.ts";

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".sh",
  ".bash",
  ".py",
  ".js",
  ".mjs",
]);

async function readShebang(filePath: string): Promise<string | undefined> {
  try {
    const head = await Bun.file(filePath).slice(0, 256).text();
    const firstLine = head.split("\n")[0] ?? "";
    if (firstLine.startsWith("#!")) return firstLine;
  } catch {
    // File unreadable — skip shebang
  }
  return undefined;
}

function runtimeFromExtension(ext: string): Runtime {
  switch (ext) {
    case ".tsx":
      return "ink";
    case ".ts":
    case ".js":
    case ".mjs":
      return "bun";
    case ".sh":
    case ".bash":
      return "bash";
    case ".py":
      return "python";
    default:
      return "executable";
  }
}

/**
 * Batch-fetch the git commit timestamp when each file was first added,
 * for all tracked files under `dir`. Returns a map of absolute path → epoch ms.
 * Falls back gracefully to an empty map outside git repos.
 */
async function getGitAddedDates(dir: string): Promise<Map<string, number>> {
  const dates = new Map<string, number>();
  try {
    const repoRoot = (
      await Bun.$`git -C ${dir} rev-parse --show-toplevel`.quiet().text()
    ).trim();

    // --diff-filter=A: only commits where the file was Added
    // --format=%at: unix epoch seconds
    // --name-only: file paths relative to repo root
    // Scoped to `dir` so we only scan action files
    const output =
      await Bun.$`git -C ${repoRoot} log --all --diff-filter=A --format=%at --name-only -- ${dir}`
        .quiet()
        .text();
    let currentTimestamp = 0;
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\d+$/.test(trimmed)) {
        currentTimestamp = Number.parseInt(trimmed, 10) * 1000;
      } else {
        const absPath = join(repoRoot, trimmed);
        // git log outputs newest-first, so the last timestamp we see for a file
        // is the oldest (when it was first added). Always overwrite.
        dates.set(absPath, currentTimestamp);
      }
    }
  } catch {
    // Not a git repo or git not available — no dates
  }
  return dates;
}

export async function loadActions(
  actionsDir: string,
  origin: ActionOrigin = { type: "local" },
): Promise<Action[]> {
  const actions: Action[] = [];
  const gitDates = await getGitAddedDates(actionsDir);
  await scanDirectory(actionsDir, actionsDir, [], actions, 0, gitDates, origin);
  actions.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  return actions;
}

async function scanDirectory(
  baseDir: string,
  currentDir: string,
  category: string[],
  actions: Action[],
  depth: number,
  gitDates?: Map<string, number>,
  origin: ActionOrigin = { type: "local" },
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
      await scanDirectory(
        baseDir,
        fullPath,
        [...category, entry.name],
        actions,
        depth + 1,
        gitDates,
        origin,
      );
    } else if (entry.isFile()) {
      const ext = `.${entry.name.split(".").pop()}`;
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      const [meta, shebang] = await Promise.all([
        extractMetadata(fullPath),
        readShebang(fullPath),
      ]);
      const addedAt = gitDates?.get(fullPath);
      const id = [...category, entry.name.replace(/\.[^.]+$/, "")].join("/");

      actions.push({
        id,
        meta,
        filePath: fullPath,
        category,
        runtime: runtimeFromExtension(ext),
        addedAt,
        origin,
        ...(shebang ? { shebang } : {}),
      });
    }
  }
}

export function findZcliDir(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".kadai");
    if (Bun.file(join(candidate, "actions")).name) {
      // Check if .kadai directory exists by trying to access it
      try {
        const stat = require("node:fs").statSync(candidate);
        if (stat.isDirectory()) return candidate;
      } catch {
        // Continue searching upward
      }
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
