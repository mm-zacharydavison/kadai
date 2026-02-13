import { copyFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Action, ShareConfig } from "../types.ts";

export interface ShareResult {
  status: "success" | "error";
  error?: string;
  /** PR URL, populated when strategy = "pr" */
  prUrl?: string;
  /** Branch name, populated when strategy = "branch" or "pr" */
  branchName?: string;
}

interface ShareOptions {
  actions: Action[];
  sourceRepoPath: string;
  /** Subdirectory within the source repo to place files (e.g. "actions/@org/username") */
  targetPath: string;
  /** Share strategy config; defaults to push */
  share?: ShareConfig;
}

/**
 * Copy action files into a source repo and push according to the configured strategy.
 */
export async function shareToSource(opts: ShareOptions): Promise<ShareResult> {
  const { actions, sourceRepoPath, targetPath, share } = opts;
  const strategy = share?.strategy ?? "push";

  try {
    if (strategy === "push") {
      return await pushStrategy(actions, sourceRepoPath, targetPath);
    }
    if (strategy === "branch") {
      return await branchStrategy(actions, sourceRepoPath, targetPath);
    }
    if (strategy === "pr") {
      return await prStrategy(
        actions,
        sourceRepoPath,
        targetPath,
        share?.reviewers,
      );
    }
    return { status: "error", error: `Unknown strategy: ${strategy}` };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildCommitMessage(actions: Action[]): string {
  const actionNames = actions.map((a) => a.meta.name).join(", ");
  return actions.length === 1
    ? `Add ${actionNames} action`
    : `Add actions: ${actionNames}`;
}

async function copyAndStage(
  actions: Action[],
  sourceRepoPath: string,
  targetPath: string,
): Promise<void> {
  const targetDir = join(sourceRepoPath, targetPath);
  await mkdir(targetDir, { recursive: true });

  for (const action of actions) {
    const fileName = basename(action.filePath);
    const destPath = join(targetDir, fileName);
    await copyFile(action.filePath, destPath);
    await Bun.$`git -C ${sourceRepoPath} add ${destPath}`.quiet();
  }
}

/**
 * Push directly to the current branch (default, existing behavior).
 */
async function pushStrategy(
  actions: Action[],
  sourceRepoPath: string,
  targetPath: string,
): Promise<ShareResult> {
  // Pull latest before making changes
  try {
    await Bun.$`git -C ${sourceRepoPath} pull --rebase --quiet`.quiet();
  } catch {
    // No remote or offline
  }

  await copyAndStage(actions, sourceRepoPath, targetPath);
  await Bun.$`git -C ${sourceRepoPath} commit -m ${buildCommitMessage(actions)}`.quiet();

  try {
    await Bun.$`git -C ${sourceRepoPath} push`.quiet();
  } catch {
    // No remote or offline
  }

  return { status: "success" };
}

/**
 * Push to a persistent `xcli-actions` branch.
 */
async function branchStrategy(
  actions: Action[],
  sourceRepoPath: string,
  targetPath: string,
): Promise<ShareResult> {
  const branchName = "xcli-actions";

  // Fetch latest
  try {
    await Bun.$`git -C ${sourceRepoPath} fetch origin`.quiet();
  } catch {
    // No remote or offline
  }

  // Checkout or create the branch
  try {
    await Bun.$`git -C ${sourceRepoPath} checkout ${branchName}`.quiet();
  } catch {
    await Bun.$`git -C ${sourceRepoPath} checkout -b ${branchName}`.quiet();
  }

  await copyAndStage(actions, sourceRepoPath, targetPath);
  await Bun.$`git -C ${sourceRepoPath} commit -m ${buildCommitMessage(actions)}`.quiet();

  try {
    await Bun.$`git -C ${sourceRepoPath} push origin ${branchName}`.quiet();
  } catch {
    // No remote or offline
  }

  return { status: "success", branchName };
}

/**
 * Create a feature branch, push, and open a PR via `gh`.
 */
async function prStrategy(
  actions: Action[],
  sourceRepoPath: string,
  targetPath: string,
  reviewers?: string[],
): Promise<ShareResult> {
  const timestamp = Date.now();
  const branchName = `xcli/add-actions-${timestamp}`;
  const commitMessage = buildCommitMessage(actions);

  // Pull latest default branch
  try {
    await Bun.$`git -C ${sourceRepoPath} pull --rebase --quiet`.quiet();
  } catch {
    // No remote or offline
  }

  // Create feature branch
  await Bun.$`git -C ${sourceRepoPath} checkout -b ${branchName}`.quiet();

  await copyAndStage(actions, sourceRepoPath, targetPath);
  await Bun.$`git -C ${sourceRepoPath} commit -m ${commitMessage}`.quiet();

  // Push the branch
  try {
    await Bun.$`git -C ${sourceRepoPath} push -u origin ${branchName}`.quiet();
  } catch {
    // No remote or offline — branch and commit are still local
    return { status: "success", branchName };
  }

  // Create PR via gh
  const prArgs = [
    "pr",
    "create",
    "--title",
    commitMessage,
    "--body",
    `Shared via xcli\n\nActions: ${actions.map((a) => a.meta.name).join(", ")}`,
  ];
  if (reviewers && reviewers.length > 0) {
    prArgs.push("--reviewer", reviewers.join(","));
  }

  const prResult =
    await Bun.$`git -C ${sourceRepoPath} rev-parse --show-toplevel`.quiet();
  const repoRoot = (await new Response(prResult.stdout).text()).trim();
  const proc = Bun.spawn(["gh", ...prArgs], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [prStdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return {
      status: "success",
      branchName,
    };
  }

  const prUrl = prStdout.trim();
  return { status: "success", prUrl, branchName };
}
