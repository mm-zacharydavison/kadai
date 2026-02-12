import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Action, ActionSource, Runtime } from "../types.ts";
import { extractMetadata } from "./metadata.ts";

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
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

export async function loadActions(
  actionsDir: string,
  source?: ActionSource,
): Promise<Action[]> {
  const actions: Action[] = [];
  await scanDirectory(actionsDir, actionsDir, [], actions, 0, source);
  actions.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  return actions;
}

async function scanDirectory(
  baseDir: string,
  currentDir: string,
  category: string[],
  actions: Action[],
  depth: number,
  source?: ActionSource,
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
        source,
      );
    } else if (entry.isFile()) {
      const ext = `.${entry.name.split(".").pop()}`;
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      const [meta, shebang] = await Promise.all([
        extractMetadata(fullPath),
        readShebang(fullPath),
      ]);
      const idParts = [...category, entry.name.replace(/\.[^.]+$/, "")];
      const rawId = idParts.join("/");
      const id =
        source && source.type !== "local" ? `${source.label}:${rawId}` : rawId;

      actions.push({
        id,
        meta,
        filePath: fullPath,
        category,
        runtime: runtimeFromExtension(ext),
        ...(shebang ? { shebang } : {}),
        ...(source ? { source } : {}),
      });
    }
  }
}

export function findXcliDir(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".xcli");
    if (Bun.file(join(candidate, "actions")).name) {
      // Check if .xcli directory exists by trying to access it
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
