import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { loadActions } from "./loader.ts";
import { resolveCommand } from "./runner.ts";

interface ListOptions {
  kadaiDir: string;
  all: boolean;
}

interface RunOptions {
  kadaiDir: string;
  actionId: string;
  cwd: string;
}

export async function handleList(options: ListOptions): Promise<never> {
  const { kadaiDir, all } = options;
  const config = await loadConfig(kadaiDir);
  const actionsDir = join(kadaiDir, config.actionsDir ?? "actions");
  const actions = await loadActions(actionsDir);

  const filtered = all ? actions : actions.filter((a) => !a.meta.hidden);

  const output = filtered.map((a) => ({
    id: a.id,
    name: a.meta.name,
    emoji: a.meta.emoji,
    description: a.meta.description,
    category: a.category,
    runtime: a.runtime,
    confirm: a.meta.confirm ?? false,
  }));

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(0);
}

export async function handleRun(options: RunOptions): Promise<never> {
  const { kadaiDir, actionId, cwd } = options;
  const config = await loadConfig(kadaiDir);
  const actionsDir = join(kadaiDir, config.actionsDir ?? "actions");
  const actions = await loadActions(actionsDir);

  const action = actions.find((a) => a.id === actionId);
  if (!action) {
    process.stderr.write(`Error: action "${actionId}" not found\n`);
    process.exit(1);
  }

  const cmd = resolveCommand(action);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(config.env ?? {}),
  };

  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env,
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}
