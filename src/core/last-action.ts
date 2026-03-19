import { join } from "node:path";

const LAST_ACTION_FILE = ".last-action";

export async function saveLastAction(
  kadaiDir: string,
  actionId: string,
): Promise<void> {
  await Bun.write(join(kadaiDir, LAST_ACTION_FILE), actionId);
  await ensureGitignore(kadaiDir);
}

async function ensureGitignore(kadaiDir: string): Promise<void> {
  const gitignorePath = join(kadaiDir, ".gitignore");
  const file = Bun.file(gitignorePath);

  if (await file.exists()) {
    const content = await file.text();
    const lines = content.split("\n").map((l) => l.trim());
    if (!lines.includes(LAST_ACTION_FILE)) {
      const suffix = content.endsWith("\n") ? "" : "\n";
      await Bun.write(gitignorePath, `${content}${suffix}${LAST_ACTION_FILE}\n`);
    }
  } else {
    await Bun.write(gitignorePath, `${LAST_ACTION_FILE}\n`);
  }
}

export async function loadLastAction(
  kadaiDir: string,
): Promise<string | null> {
  const file = Bun.file(join(kadaiDir, LAST_ACTION_FILE));
  if (!(await file.exists())) return null;
  const content = (await file.text()).trim();
  return content || null;
}
