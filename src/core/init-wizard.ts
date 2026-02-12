import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SourceConfig } from "../types.ts";

// ─── Dependency injection for testability ─────────────────────────

interface CmdResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InitDeps {
  ghApi: (endpoint: string) => Promise<CmdResult>;
  ghRepoCreate: (repoName: string) => Promise<CmdResult>;
  bunWhich: (name: string) => string | null;
}

export function defaultDeps(): InitDeps {
  return {
    async ghApi(endpoint: string): Promise<CmdResult> {
      const proc = Bun.spawn(["gh", "api", endpoint], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { exitCode, stdout, stderr };
    },
    async ghRepoCreate(repoName: string): Promise<CmdResult> {
      const proc = Bun.spawn(
        [
          "gh",
          "repo",
          "create",
          repoName,
          "--public",
          "--description",
          "Shared xcli actions",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { exitCode, stdout, stderr };
    },
    bunWhich(name: string): string | null {
      return Bun.which(name);
    },
  };
}

// ─── Detection utilities ──────────────────────────────────────────

export async function detectXcliActionsRepo(
  owner: string,
  deps: InitDeps = defaultDeps(),
): Promise<{ repo: string; defaultBranch: string } | null> {
  try {
    const result = await deps.ghApi(`repos/${owner}/xcli-actions`);
    if (result.exitCode !== 0) return null;
    const data = JSON.parse(result.stdout);
    return {
      repo: data.full_name,
      defaultBranch: data.default_branch,
    };
  } catch {
    return null;
  }
}

export async function detectAiCli(
  deps: InitDeps = defaultDeps(),
): Promise<boolean> {
  return deps.bunWhich("claude") !== null;
}

export async function validateRepo(
  repo: string,
  deps: InitDeps = defaultDeps(),
): Promise<{ valid: boolean; defaultBranch?: string }> {
  try {
    const result = await deps.ghApi(`repos/${repo}`);
    if (result.exitCode !== 0) return { valid: false };
    const data = JSON.parse(result.stdout);
    return { valid: true, defaultBranch: data.default_branch };
  } catch {
    return { valid: false };
  }
}

export async function createXcliActionsRepo(
  owner: string,
  deps: InitDeps = defaultDeps(),
): Promise<
  | { success: true; repo: string; defaultBranch: string }
  | { success: false; permissionError: boolean }
> {
  try {
    const result = await deps.ghRepoCreate(`${owner}/xcli-actions`);
    if (result.exitCode !== 0) {
      const isPermission =
        result.stderr.includes("permission") || result.stderr.includes("403");
      return { success: false, permissionError: isPermission };
    }
    // Fetch default branch of the newly created repo
    const info = await deps.ghApi(`repos/${owner}/xcli-actions`);
    if (info.exitCode === 0) {
      const data = JSON.parse(info.stdout);
      return {
        success: true,
        repo: `${owner}/xcli-actions`,
        defaultBranch: data.default_branch,
      };
    }
    return {
      success: true,
      repo: `${owner}/xcli-actions`,
      defaultBranch: "main",
    };
  } catch {
    return { success: false, permissionError: false };
  }
}

// ─── Config file generation ───────────────────────────────────────

export function generateConfigFile(options: {
  sources: SourceConfig[];
  aiEnabled: boolean;
}): string {
  const { sources, aiEnabled } = options;
  const activeLines: string[] = [];
  const commentedLines: string[] = [];

  // Sources
  if (sources.length > 0) {
    const sourceEntries = sources.map((s) => {
      const parts = [`repo: "${s.repo}"`];
      if (s.ref && s.ref !== "main") {
        parts.push(`ref: "${s.ref}"`);
      }
      return `    { ${parts.join(", ")} },`;
    });
    activeLines.push("  sources: [");
    activeLines.push(...sourceEntries);
    activeLines.push("  ],");
  } else {
    commentedLines.push("  // sources: [],");
  }

  // AI
  if (!aiEnabled) {
    activeLines.push("  ai: { enabled: false },");
  } else {
    commentedLines.push("  // ai: { enabled: true },");
  }

  // Always-commented defaults
  commentedLines.push(
    '  // actionsDir: "actions",',
    "  // env: {},",
    "  // hooks: {",
    '  //   before: "",',
    '  //   after: "",',
    "  // },",
  );

  const allLines = [...activeLines];
  if (activeLines.length > 0 && commentedLines.length > 0) {
    allLines.push("");
  }
  allLines.push(...commentedLines);

  return `export default {\n${allLines.join("\n")}\n};\n`;
}

// ─── Init result ──────────────────────────────────────────────────

export interface InitResult {
  xcliDir: string;
  sources: SourceConfig[];
  aiEnabled: boolean;
}

// ─── File writing (used by InitWizard component) ─────────────────

export interface WriteInitFilesResult {
  sampleCreated: boolean;
}

export async function writeInitFiles(
  cwd: string,
  sources: SourceConfig[],
  aiEnabled: boolean,
): Promise<WriteInitFilesResult> {
  const xcliDir = join(cwd, ".xcli");
  const actionsDir = join(xcliDir, "actions");
  mkdirSync(actionsDir, { recursive: true });

  // Sample action
  const sampleAction = join(actionsDir, "hello.sh");
  const sampleFile = Bun.file(sampleAction);
  let sampleCreated = false;
  if (!(await sampleFile.exists())) {
    await Bun.write(
      sampleAction,
      `#!/bin/bash
# xcli:name Hello World
# xcli:emoji 👋
# xcli:description A sample action — edit or delete this file

echo "Hello from xcli!"
echo "Add your own scripts to .xcli/actions/ to get started."
`,
    );
    sampleCreated = true;
  }

  // Config file
  const configContent = generateConfigFile({ sources, aiEnabled });
  const configPath = join(xcliDir, "config.ts");
  await Bun.write(configPath, configContent);

  return { sampleCreated };
}
