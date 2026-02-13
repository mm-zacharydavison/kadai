import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ShareConfig, SourceConfig } from "../types.ts";
import { detectRepoIdentity, type RepoIdentity } from "./git-utils.ts";

// ─── Dependency injection for testability ─────────────────────────

interface CmdResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InitDeps {
  ghApi: (
    endpoint: string,
    opts?: { method?: string; fields?: Record<string, string> },
  ) => Promise<CmdResult>;
  ghRepoCreate: (repoName: string) => Promise<CmdResult>;
  bunWhich: (name: string) => string | null;
  detectRepo: (cwd: string) => Promise<RepoIdentity | null>;
}

export function defaultDeps(): InitDeps {
  return {
    async ghApi(
      endpoint: string,
      opts?: { method?: string; fields?: Record<string, string> },
    ): Promise<CmdResult> {
      const args = ["gh", "api", endpoint];
      if (opts?.method) {
        args.push("--method", opts.method);
      }
      if (opts?.fields) {
        for (const [key, value] of Object.entries(opts.fields)) {
          args.push("--field", `${key}=${value}`);
        }
      }
      const proc = Bun.spawn(args, {
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
    detectRepo(cwd: string): Promise<RepoIdentity | null> {
      return detectRepoIdentity(cwd);
    },
  };
}

// ─── Detection/API utilities ──────────────────────────────────────

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

export interface MemberInfo {
  login: string;
}

export interface TeamInfo {
  slug: string;
  name: string;
}

export interface ReviewerOption {
  value: string;
  label: string;
  type: "user" | "team";
  displayName?: string;
}

export interface OrgInfo {
  login: string;
}

export async function fetchOrgs(
  deps: InitDeps = defaultDeps(),
): Promise<OrgInfo[]> {
  try {
    const result = await deps.ghApi("user/orgs");
    if (result.exitCode !== 0) return [];
    const data = JSON.parse(result.stdout);
    if (!Array.isArray(data)) return [];
    return data.map((o: { login: string }) => ({ login: o.login }));
  } catch {
    return [];
  }
}

export async function fetchGitHubUsername(
  deps: InitDeps = defaultDeps(),
): Promise<string | null> {
  try {
    const result = await deps.ghApi("user");
    if (result.exitCode !== 0) return null;
    const data = JSON.parse(result.stdout);
    return data.login ?? null;
  } catch {
    return null;
  }
}

export async function fetchRepoCollaborators(
  repo: string,
  deps: InitDeps = defaultDeps(),
): Promise<MemberInfo[]> {
  try {
    const result = await deps.ghApi(`repos/${repo}/collaborators`);
    if (result.exitCode !== 0) return [];
    const data = JSON.parse(result.stdout);
    if (!Array.isArray(data)) return [];
    return data.map((m: { login: string }) => ({ login: m.login }));
  } catch {
    return [];
  }
}

export async function fetchOrgMembers(
  org: string,
  deps: InitDeps = defaultDeps(),
): Promise<MemberInfo[]> {
  try {
    const result = await deps.ghApi(`orgs/${org}/members`);
    if (result.exitCode !== 0) return [];
    const data = JSON.parse(result.stdout);
    if (!Array.isArray(data)) return [];
    return data.map((m: { login: string }) => ({ login: m.login }));
  } catch {
    return [];
  }
}

export async function fetchOrgTeams(
  org: string,
  deps: InitDeps = defaultDeps(),
): Promise<TeamInfo[]> {
  try {
    const result = await deps.ghApi(`orgs/${org}/teams`);
    if (result.exitCode !== 0) return [];
    const data = JSON.parse(result.stdout);
    if (!Array.isArray(data)) return [];
    return data.map((t: { slug: string; name: string }) => ({
      slug: t.slug,
      name: t.name,
    }));
  } catch {
    return [];
  }
}

export async function fetchUserDisplayName(
  login: string,
  deps: InitDeps = defaultDeps(),
): Promise<string | null> {
  try {
    const result = await deps.ghApi(`users/${login}`);
    if (result.exitCode !== 0) return null;
    const data = JSON.parse(result.stdout);
    return data.name ?? null;
  } catch {
    return null;
  }
}

export async function fetchReviewerOptions(
  repo: string,
  deps: InitDeps = defaultDeps(),
): Promise<ReviewerOption[]> {
  const [repoOrg] = repo.split("/");
  const logins: string[] = [];

  // Fetch users: collaborators first, fall back to org members
  const collaborators = await fetchRepoCollaborators(repo, deps);
  if (collaborators.length > 0) {
    for (const c of collaborators) {
      logins.push(c.login);
    }
  } else if (repoOrg) {
    const orgMembers = await fetchOrgMembers(repoOrg, deps);
    for (const m of orgMembers) {
      logins.push(m.login);
    }
  }

  // Ensure the current authenticated user is in the list
  const currentUser = await fetchGitHubUsername(deps);
  if (currentUser && !logins.includes(currentUser)) {
    logins.push(currentUser);
  }

  // Fetch display names for all users in parallel
  const displayNames = await Promise.all(
    logins.map((login) => fetchUserDisplayName(login, deps)),
  );

  const options: ReviewerOption[] = logins.map((login, i) => ({
    value: login,
    label: login,
    type: "user" as const,
    displayName: displayNames[i] ?? undefined,
  }));

  // Fetch teams
  if (repoOrg) {
    const teams = await fetchOrgTeams(repoOrg, deps);
    for (const t of teams) {
      options.push({
        value: `${repoOrg}/${t.slug}`,
        label: `${t.name}`,
        type: "team",
      });
    }
  }

  return options;
}

export async function setupBranchProtection(
  owner: string,
  repo: string,
  branch: string,
  deps: InitDeps = defaultDeps(),
): Promise<boolean> {
  try {
    const result = await deps.ghApi(
      `repos/${owner}/${repo}/branches/${branch}/protection`,
      {
        method: "PUT",
        fields: {
          required_pull_request_reviews:
            '{"required_approving_review_count":1}',
        },
      },
    );
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ─── Config file generation ───────────────────────────────────────

export interface GenerateConfigOptions {
  sources: SourceConfig[];
  aiEnabled: boolean;
  share?: ShareConfig;
  org?: string;
  autoNavigate?: string[];
}

export function generateConfigFile(options: GenerateConfigOptions): string {
  const { sources, aiEnabled, share, org, autoNavigate } = options;
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

  // Share config
  if (share && share.strategy !== "push") {
    const shareParts: string[] = [`strategy: "${share.strategy}"`];
    if (share.reviewers && share.reviewers.length > 0) {
      const items = share.reviewers.map((r) => `"${r}"`).join(", ");
      shareParts.push(`reviewers: [${items}]`);
    }
    activeLines.push(`  share: { ${shareParts.join(", ")} },`);
  }

  // AI
  if (!aiEnabled) {
    activeLines.push("  ai: { enabled: false },");
  } else {
    commentedLines.push("  // ai: { enabled: true },");
  }

  // Identity
  if (org) {
    activeLines.push(`  org: "${org}",`);
  }
  // Auto-navigate
  if (autoNavigate && autoNavigate.length > 0) {
    const items = autoNavigate.map((p) => `"${p}"`).join(", ");
    activeLines.push(`  autoNavigate: [${items}],`);
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
  configOptions: GenerateConfigOptions,
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
  const configContent = generateConfigFile(configOptions);
  const configPath = join(xcliDir, "config.ts");
  await Bun.write(configPath, configContent);

  return { sampleCreated };
}
