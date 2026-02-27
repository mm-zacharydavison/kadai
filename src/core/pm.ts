import { join } from "node:path";
import { cachedWhich } from "./which.ts";

export interface ResolvedPM {
  /** Binary name, e.g. "bun", "npm" */
  bin: string;
  /** Full install command, e.g. ["bun", "install"] */
  install: string[];
}

/** Priority-ordered package manager chain (mirrors runner.ts node chain) */
const PM_CHAIN: Array<{ bin: string; install: string[] }> = [
  { bin: "bun", install: ["bun", "install"] },
  { bin: "npm", install: ["npm", "install"] },
];

/**
 * Resolve the package manager to use for a given directory.
 *
 * Resolution order:
 * 1. Check package.json `packageManager` field (corepack convention)
 * 2. Try availability chain: bun → npm
 * 3. Throw if none found
 */
export async function resolvePM(dir: string): Promise<ResolvedPM> {
  // 1. Check packageManager field in package.json
  const pkgJsonPath = join(dir, "package.json");
  try {
    const file = Bun.file(pkgJsonPath);
    if (await file.exists()) {
      const pkg = await file.json();
      if (typeof pkg.packageManager === "string") {
        // Format: "pnpm@9.1.0" or just "pnpm"
        const bin = pkg.packageManager.split("@")[0];
        if (bin && cachedWhich(bin)) {
          return { bin, install: [bin, "install"] };
        }
      }
    }
  } catch {
    // package.json unreadable or malformed — fall through
  }

  // 2. Availability chain
  for (const candidate of PM_CHAIN) {
    if (cachedWhich(candidate.bin)) {
      return candidate;
    }
  }

  // 3. Error
  throw new Error(
    `No package manager found. Install bun or npm to use plugin dependencies.`,
  );
}
