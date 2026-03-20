import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { enterFullscreen } from "./fullscreen.ts";
import { loadActions } from "./loader.ts";
import { saveLastAction, loadLastAction } from "./last-action.ts";
import { buildInjection, buildStdinStream, filterSensitiveInputs, runWithStdinRecording } from "./inputs.ts";
import { ensureKadaiResolvable } from "./shared-deps.ts";
import {
  loadCachedPlugins,
  loadPathPlugin,
  loadUserGlobalActions,
  syncPlugins,
} from "./plugins.ts";
import { resolveCommand } from "./runner.ts";
import type { InputValues } from "../types.ts";

interface ListOptions {
  kadaiDir: string;
  all: boolean;
}

interface RunOptions {
  kadaiDir: string;
  actionId: string;
  cwd: string;
  inputs?: InputValues;
}

export async function handleList(options: ListOptions): Promise<never> {
  const { kadaiDir, all } = options;
  const config = await loadConfig(kadaiDir);
  const actionsDir = join(kadaiDir, config.actionsDir ?? "actions");

  // Load all action sources
  let actions = await loadActions(actionsDir);
  const globalActions = await loadUserGlobalActions();
  actions = [...actions, ...globalActions];

  if (config.plugins) {
    for (const source of config.plugins) {
      if ("path" in source) {
        const pathActions = await loadPathPlugin(kadaiDir, source);
        actions = [...actions, ...pathActions];
      }
    }
    const cachedActions = await loadCachedPlugins(kadaiDir, config.plugins);
    actions = [...actions, ...cachedActions];
  }

  const filtered = all ? actions : actions.filter((a) => !a.meta.hidden);

  const output = filtered.map((a) => ({
    id: a.id,
    name: a.meta.name,
    emoji: a.meta.emoji,
    description: a.meta.description,
    category: a.category,
    runtime: a.runtime,
    confirm: a.meta.confirm ?? false,
    fullscreen: a.meta.fullscreen ?? false,
    origin: a.origin,
  }));

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(0);
}

export async function handleRun(options: RunOptions): Promise<never> {
  const { kadaiDir, actionId, cwd, inputs } = options;
  const hasProvidedInputs = inputs !== undefined && Object.keys(inputs).length > 0;
  const resolvedInputs = inputs ?? {};
  const config = await loadConfig(kadaiDir);
  const actionsDir = join(kadaiDir, config.actionsDir ?? "actions");

  // Load all action sources
  let actions = await loadActions(actionsDir);
  const globalActions = await loadUserGlobalActions();
  actions = [...actions, ...globalActions];

  if (config.plugins) {
    for (const source of config.plugins) {
      if ("path" in source) {
        const pathActions = await loadPathPlugin(kadaiDir, source);
        actions = [...actions, ...pathActions];
      }
    }
    const cachedActions = await loadCachedPlugins(kadaiDir, config.plugins);
    actions = [...actions, ...cachedActions];
  }

  const action = actions.find((a) => a.id === actionId);
  if (!action) {
    process.stderr.write(`Error: action "${actionId}" not found\n`);
    process.exit(1);
  }

  if (action.runtime === "ink") {
    await saveLastAction(kadaiDir, actionId, {});
    // Ensure "kadai/ink", "kadai/react", etc. resolve from the project
    const cleanupKadai = ensureKadaiResolvable(join(cwd, "node_modules"));

    const mod = await import(action.filePath);
    if (typeof mod.default !== "function") {
      process.stderr.write(
        `Error: "${action.filePath}" does not export a default function component\n`,
      );
      process.exit(1);
    }

    const cleanupFullscreen = action.meta.fullscreen
      ? enterFullscreen()
      : undefined;

    const React = await import("react");
    const { render } = await import("ink");
    const instance = render(
      React.createElement(mod.default, {
        cwd,
        env: config.env ?? {},
        args: [],
        onExit: () => instance.unmount(),
      }),
    );
    await instance.waitUntilExit();
    cleanupFullscreen?.();
    cleanupKadai?.();
    process.exit(0);
  }

  const cmd = resolveCommand(action);

  // Recording mode: no pre-provided inputs, script reads from stdin naturally.
  // Capture what it reads and save for --rerun replay.
  if (action.meta.inputs?.length && !hasProvidedInputs) {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(config.env ?? {}),
    };
    const { exitCode, values } = await runWithStdinRecording(cmd, { cwd, env, inputs: action.meta.inputs });
    await saveLastAction(kadaiDir, actionId, filterSensitiveInputs(action.meta.inputs, values));
    process.exit(exitCode);
  }

  // Replay mode: pre-provided inputs are fed as stdin preamble + env vars.
  await saveLastAction(kadaiDir, actionId, filterSensitiveInputs(action.meta.inputs ?? [], resolvedInputs));
  const injection = buildInjection(action.meta.inputs ?? [], resolvedInputs);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(config.env ?? {}),
    ...injection.env,
  };

  // Clean up stdin so the child process gets direct terminal access.
  // This is critical for programs like sudo that need raw terminal control.
  process.stdin.removeAllListeners();
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  process.stdin.unref();

  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: injection.stdinPreamble ? buildStdinStream(injection.stdinPreamble) : "inherit",
    env,
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

interface RerunOptions {
  kadaiDir: string;
  cwd: string;
}

export async function handleRerun(options: RerunOptions): Promise<never> {
  const { kadaiDir, cwd } = options;
  const record = await loadLastAction(kadaiDir);
  if (!record) {
    process.stderr.write(
      "No last action found. Run an action first before using --rerun.\n",
    );
    process.exit(1);
  }
  return handleRun({ kadaiDir, actionId: record.actionId, cwd, inputs: record.inputs });
}

interface SyncOptions {
  kadaiDir: string;
}

export async function handleSync(options: SyncOptions): Promise<never> {
  const { kadaiDir } = options;
  const config = await loadConfig(kadaiDir);

  if (!config.plugins || config.plugins.length === 0) {
    process.stdout.write("No plugins configured.\n");
    process.exit(0);
  }

  process.stdout.write("Syncing plugins...\n");

  const results: Array<{ name: string; status: "done" | "error" }> = [];

  await syncPlugins(kadaiDir, config.plugins, {
    onPluginStatus: (name, status) => {
      if (status === "syncing") {
        process.stdout.write(`  ⟳ ${name}\n`);
      } else if (status === "done") {
        results.push({ name, status: "done" });
      } else if (status === "error") {
        results.push({ name, status: "error" });
      }
    },
    onUpdate: () => {},
  });

  // Print summary
  process.stdout.write("\n");
  for (const r of results) {
    const icon = r.status === "done" ? "✓" : "✗";
    process.stdout.write(`  ${icon} ${r.name}\n`);
  }

  const failed = results.filter((r) => r.status === "error").length;
  if (failed > 0) {
    process.stdout.write(`\n${failed} plugin(s) failed to sync.\n`);
    process.exit(1);
  }

  process.stdout.write("\nAll plugins synced.\n");
  process.exit(0);
}
