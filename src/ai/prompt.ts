import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".sh",
  ".bash",
  ".py",
  ".js",
  ".mjs",
]);

/**
 * Recursively list action files relative to the base directory.
 * Ignores files starting with _ or . (matching loader.ts conventions).
 */
async function listActionFiles(
  baseDir: string,
  currentDir: string,
  depth = 0,
): Promise<string[]> {
  if (depth > 3) return [];

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

    const fullPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      const sub = await listActionFiles(baseDir, fullPath, depth + 1);
      files.push(...sub);
    } else if (entry.isFile()) {
      const ext = `.${entry.name.split(".").pop()}`;
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        files.push(relative(baseDir, fullPath));
      }
    }
  }

  return files.sort();
}

/**
 * Build the system prompt appended to Claude Code when generating xcli actions.
 * Includes xcli conventions, metadata format, supported languages, and
 * a listing of existing actions so Claude can avoid conflicts.
 */
export async function buildSystemPrompt(
  xcliDir: string,
  actionsDir: string,
): Promise<string> {
  const existingFiles = await listActionFiles(actionsDir, actionsDir);

  const existingSection =
    existingFiles.length > 0
      ? `Existing actions:\n${existingFiles
          .slice(0, 50)
          .map((f) => `  - ${f}`)
          .join(
            "\n",
          )}${existingFiles.length > 50 ? `\n  ... and ${existingFiles.length - 50} more` : ""}`
      : "No existing actions in this directory yet.";

  return `You are generating xcli actions. xcli is a CLI tool that lets users browse and run scripts from a .xcli/actions/ directory.

## xcli directory: ${xcliDir}

## Actions directory

All new scripts MUST be created inside:
  ${actionsDir}

Use subdirectories for categories (e.g. ${actionsDir}/deploy/staging.sh).

## Metadata format

Add comment frontmatter in the first few lines of each script:

For bash/python (# comments):
  # xcli:name My Action Name
  # xcli:emoji 🚀
  # xcli:description A short description of what this does
  # xcli:confirm true

For TypeScript/JavaScript (// comments):
  // xcli:name My Action Name
  // xcli:emoji 🚀
  // xcli:description A short description of what this does
  // xcli:confirm true

Fields:
  - xcli:name (required) — Display name in menus
  - xcli:emoji (optional) — Emoji shown before the name
  - xcli:description (optional) — Short description shown alongside the name
  - xcli:confirm (optional) — Set to "true" to require confirmation before running

## Supported languages

  - .sh / .bash — Bash scripts (use #!/bin/bash or #!/usr/bin/env bash)
  - .ts — TypeScript (runs with Bun)
  - .js / .mjs — JavaScript (runs with Bun)
  - .py — Python (use #!/usr/bin/env -S uv run for inline deps, or #!/usr/bin/env python3)

## Best practices

  - Always include a shebang line (#!/bin/bash, #!/usr/bin/env bun, etc.)
  - For bash: use \`set -euo pipefail\` after the shebang
  - Keep scripts self-contained — avoid external dependencies when possible
  - Make scripts executable concepts, not library code
  - If a script modifies or deletes files, include a --dry-run flag

## ${existingSection}`;
}
