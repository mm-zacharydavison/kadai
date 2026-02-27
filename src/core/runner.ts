import type { Action, Runtime } from "../types.ts";
import { cachedWhich } from "./which.ts";

/**
 * Parse a shebang line into a command array.
 * Returns null if shebang is missing or invalid.
 */
export function parseShebangCommand(
  shebang: string | undefined,
  filePath: string,
): string[] | null {
  if (!shebang || !shebang.startsWith("#!")) return null;

  const line = shebang.slice(2).trim();
  if (!line) return null;

  const parts = line.split(/\s+/);
  const interpreter = parts[0];

  // Handle /usr/bin/env style shebangs
  if (interpreter === "/usr/bin/env") {
    const args = parts.slice(1);
    // Handle -S flag (split remaining as separate args)
    if (args[0] === "-S" && args.length > 1) {
      return [...args.slice(1), filePath];
    }
    if (args.length > 0) {
      return [...args, filePath];
    }
    return null;
  }

  // Absolute path interpreter (e.g. #!/bin/bash, #!/usr/bin/perl -w)
  return [...parts, filePath];
}

/** Per-runtime interpreter chains, tried in priority order */
const RUNTIME_CHAINS: Record<Runtime, string[][]> = {
  python: [["uv", "run"], ["python3"], ["python"]],
  bash: [["bash"]],
  bun: [["bun", "run"]],
  node: [["bun", "run"], ["node"]],
  ink: [],
  executable: [],
};

/** Hardcoded fallback commands (original behavior) */
const FALLBACK_COMMANDS: Record<Runtime, (filePath: string) => string[]> = {
  bun: (fp) => ["bun", "run", fp],
  bash: (fp) => ["bash", fp],
  python: (fp) => ["python3", fp],
  node: (fp) => ["node", fp],
  ink: (fp) => ["bun", "run", fp],
  executable: (fp) => [fp],
};

function resolveFromChain(runtime: Runtime, filePath: string): string[] | null {
  const chain = RUNTIME_CHAINS[runtime];
  for (const candidate of chain) {
    const bin = candidate[0] as string;
    if (cachedWhich(bin)) {
      return [...candidate, filePath];
    }
  }
  return null;
}

/**
 * Three-tier command resolution:
 * 1. Shebang (script author's explicit intent)
 * 2. Runner chain (prioritized available interpreters)
 * 3. Hardcoded fallback
 */
export function resolveCommand(action: Action): string[] {
  // 1. Shebang
  const shebangCmd = parseShebangCommand(action.shebang, action.filePath);
  if (shebangCmd) return shebangCmd;

  // 2. Runner chain
  const chainCmd = resolveFromChain(action.runtime, action.filePath);
  if (chainCmd) return chainCmd;

  // 3. Hardcoded fallback
  return FALLBACK_COMMANDS[action.runtime](action.filePath);
}
