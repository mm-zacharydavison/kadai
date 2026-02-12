import { copyFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Action } from "../types.ts";

export interface ShareResult {
  status: "success" | "error";
  error?: string;
}

interface ShareOptions {
  actions: Action[];
  sourceRepoPath: string;
  /** Subdirectory within the source repo to place files (e.g. "actions/@org/username") */
  targetPath: string;
}

/**
 * Copy action files into a source repo, commit on main, and push.
 * Pulls first to incorporate any upstream changes.
 */
export async function shareToSource(opts: ShareOptions): Promise<ShareResult> {
  const { actions, sourceRepoPath, targetPath } = opts;

  try {
    // Pull latest before making changes (ignore failure if no remote configured)
    try {
      await Bun.$`git -C ${sourceRepoPath} pull --rebase --quiet`.quiet();
    } catch {
      // No remote or offline — continue with local commit
    }

    const targetDir = join(sourceRepoPath, targetPath);
    await mkdir(targetDir, { recursive: true });

    // Copy each action file into the target directory
    for (const action of actions) {
      const fileName = basename(action.filePath);
      const destPath = join(targetDir, fileName);
      await copyFile(action.filePath, destPath);
      await Bun.$`git -C ${sourceRepoPath} add ${destPath}`.quiet();
    }

    // Commit
    const actionNames = actions.map((a) => a.meta.name).join(", ");
    const commitMessage =
      actions.length === 1
        ? `Add ${actionNames} action`
        : `Add actions: ${actionNames}`;

    await Bun.$`git -C ${sourceRepoPath} commit -m ${commitMessage}`.quiet();

    // Push directly to main (ignore failure if no remote configured)
    try {
      await Bun.$`git -C ${sourceRepoPath} push`.quiet();
    } catch {
      // No remote or offline — commit is still local
    }

    return { status: "success" };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
