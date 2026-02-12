export interface RepoIdentity {
  org: string;
  repo: string;
}

const SSH_PATTERN = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/;
const HTTPS_PATTERN = /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/;

/**
 * Parse a git remote URL to extract org and repo.
 * Supports both SSH and HTTPS GitHub URLs.
 * Returns null for non-GitHub or malformed URLs.
 */
export function parseRepoIdentity(remoteUrl: string): RepoIdentity | null {
  const sshMatch = remoteUrl.match(SSH_PATTERN);
  if (sshMatch?.[1] && sshMatch[2]) {
    return { org: sshMatch[1], repo: sshMatch[2] };
  }

  const httpsMatch = remoteUrl.match(HTTPS_PATTERN);
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return { org: httpsMatch[1], repo: httpsMatch[2] };
  }

  return null;
}

/**
 * Detect the GitHub org/repo of the git repository at `cwd`
 * by reading the origin remote URL.
 */
export async function detectRepoIdentity(
  cwd: string,
): Promise<RepoIdentity | null> {
  try {
    const result = await Bun.$`git -C ${cwd} remote get-url origin`
      .quiet()
      .text();
    return parseRepoIdentity(result.trim());
  } catch {
    return null;
  }
}
