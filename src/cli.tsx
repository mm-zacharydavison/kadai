#!/usr/bin/env bun
import { registerSharedDeps } from "./core/shared-deps.ts";

// Ensure ink/react/etc resolve to kadai's own copies when actions import them.
// Must run before any dynamic import() of .tsx action files.
registerSharedDeps();

import { parseArgs } from "./core/args.ts";
import { handleList, handleRun, handleRerun } from "./core/commands.ts";
import { findZcliDir } from "./core/loader.ts";

const cwd = process.cwd();
const parsed = parseArgs(process.argv.slice(2));

if (parsed.type === "error") {
  process.stderr.write(`${parsed.message}\n`);
  process.exit(1);
}

if (parsed.type === "version") {
  const { version } = await import("../package.json");
  console.log(version);
  process.exit(0);
}

if (parsed.type === "mcp") {
  const { ensureMcpConfig, startMcpServer } = await import("./core/mcp.ts");
  const kadaiDir = findZcliDir(cwd);
  const projectRoot = kadaiDir
    ? (await import("node:path")).dirname(kadaiDir)
    : cwd;
  await ensureMcpConfig(projectRoot);
  await startMcpServer(kadaiDir, cwd);
  // Keep the process alive — the stdio transport holds the event loop open,
  // but we must prevent the script from falling through to the TUI code below.
  await new Promise(() => {});
}

if (parsed.type === "list" || parsed.type === "run" || parsed.type === "sync" || parsed.type === "rerun") {
  const kadaiDir = findZcliDir(cwd);
  if (!kadaiDir) {
    process.stderr.write(
      "Error: No .kadai directory found. Run kadai to initialize.\n",
    );
    process.exit(1);
  }

  // Ensure Claude Code integration files exist on every run
  const { dirname } = await import("node:path");
  const { ensureClaudeIntegration } = await import("./core/init-wizard.ts");
  await ensureClaudeIntegration(dirname(kadaiDir));

  if (parsed.type === "list") {
    await handleList({ kadaiDir, all: parsed.all });
  } else if (parsed.type === "run") {
    await handleRun({ kadaiDir, actionId: parsed.actionId, cwd });
  } else if (parsed.type === "rerun") {
    await handleRerun({ kadaiDir, cwd });
  } else {
    const { handleSync } = await import("./core/commands.ts");
    await handleSync({ kadaiDir });
  }
}

// Interactive TUI mode
const { Readable } = await import("node:stream");
const { render } = await import("ink");
const React = await import("react");
const { App } = await import("./app.tsx");
const { resolveCommand } = await import("./core/runner.ts");
const { loadConfig } = await import("./core/config.ts");

import type { Action } from "./types.ts";
import { saveLastAction } from "./core/last-action.ts";
import { filterSensitiveInputs, runWithStdinRecording } from "./core/inputs.ts";

const kadaiDir = findZcliDir(cwd);
if (!kadaiDir) {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "Error: No .kadai directory found. Create a .kadai/actions/ directory to get started.\n",
    );
    process.exit(1);
  }
  const { writeInitFiles } = await import("./core/init-wizard.ts");
  console.log("No .kadai directory found. Setting one up.\n");
  const result = await writeInitFiles(cwd);
  console.log("  Created .kadai/config.ts");
  if (result.sampleCreated) console.log("  Created .kadai/actions/hello.sh");
  console.log("\nDone! Run kadai again to get started.");
  process.exit(0);
}

// Ensure Claude Code integration files exist on every run
{
  const { dirname } = await import("node:path");
  const { ensureClaudeIntegration } = await import("./core/init-wizard.ts");
  const projectRoot = dirname(kadaiDir);
  const ensured = await ensureClaudeIntegration(projectRoot);
  if (ensured.skillCreated)
    console.log("Created .claude/skills/kadai/SKILL.md");
  if (ensured.mcpConfigured) console.log("Configured kadai in .mcp.json");
}

function createStdinStream(): NodeJS.ReadStream {
  if (process.stdin.isTTY) {
    return process.stdin;
  }

  // When stdin is piped (e.g. in tests), process.stdin doesn't support raw mode,
  // and data can arrive in multi-character chunks. Ink's parseKeypress expects
  // each keypress to arrive as a separate read() call.
  //
  // Using objectMode so each push() is returned as a separate read() result,
  // preventing multiple characters from being concatenated into one chunk.
  const charStream = new Readable({
    objectMode: true,
    read() {},
  });

  Object.assign(charStream, {
    isTTY: true,
    setRawMode() {},
    ref() {},
    unref() {},
    setEncoding() {
      return charStream;
    },
  });

  // Parse input data into individual keypresses
  const parseKeypresses = (str: string): string[] => {
    const keys: string[] = [];
    let i = 0;
    while (i < str.length) {
      if (str[i] === "\x1b" && i + 1 < str.length && str[i + 1] === "[") {
        const escStart = i;
        i += 2;
        while (
          i < str.length &&
          str.charCodeAt(i) >= 0x30 &&
          str.charCodeAt(i) <= 0x3f
        )
          i++;
        while (
          i < str.length &&
          str.charCodeAt(i) >= 0x20 &&
          str.charCodeAt(i) <= 0x2f
        )
          i++;
        if (
          i < str.length &&
          str.charCodeAt(i) >= 0x40 &&
          str.charCodeAt(i) <= 0x7e
        )
          i++;
        keys.push(str.slice(escStart, i));
      } else if (
        str[i] === "\x1b" &&
        i + 1 < str.length &&
        str[i + 1] === "O"
      ) {
        keys.push(str.slice(i, i + 3));
        i += 3;
      } else {
        keys.push(str[i] as string);
        i++;
      }
    }
    return keys;
  };

  // Queue keypresses and deliver them one at a time across ticks,
  // ensuring each keypress gets its own 'readable' event cycle.
  const queue: string[] = [];
  let draining = false;

  const drainQueue = () => {
    if (queue.length === 0) {
      draining = false;
      return;
    }
    const key = queue.shift() as string;
    charStream.push(key);
    setImmediate(drainQueue);
  };

  process.stdin.on("data", (data: Buffer) => {
    const keys = parseKeypresses(data.toString());
    queue.push(...keys);
    if (!draining) {
      draining = true;
      drainQueue();
    }
  });

  process.stdin.on("end", () => {
    charStream.push(null);
  });

  return charStream as unknown as NodeJS.ReadStream;
}

let selectedAction: Action | null = null;

const stdinStream = createStdinStream();

const instance = render(
  React.createElement(App, {
    kadaiDir,
    onRunAction: (action: Action) => {
      selectedAction = action;
    },
  }),
  {
    stdin: stdinStream,
    stdout: process.stdout,
    stderr: process.stderr,
  },
);

await instance.waitUntilExit();

if (!selectedAction) process.exit(0);

// Run the selected action, replacing the kadai process
const action: Action = selectedAction;
const config = await loadConfig(kadaiDir);
const cmd = resolveCommand(action);

console.log(
  `${action.meta.emoji ? `${action.meta.emoji} ` : ""}${action.meta.name}\n`,
);

if (action.meta.inputs?.length && action.runtime !== "ink") {
  // Recording mode: script runs with a stdin proxy that captures what it reads.
  // Captured values are saved after exit for --rerun replay.
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(config.env ?? {}),
  };
  const { exitCode, values } = await runWithStdinRecording(cmd, { cwd, env, inputs: action.meta.inputs });
  await saveLastAction(kadaiDir, action.id, filterSensitiveInputs(action.meta.inputs, values));
  process.exit(exitCode);
}

// Normal mode: give the child direct terminal access.
process.stdin.removeAllListeners("data");
process.stdin.removeAllListeners("end");
if (process.stdin.isTTY) {
  process.stdin.setRawMode(false);
}
process.stdin.pause();
process.stdin.unref();

await saveLastAction(kadaiDir, action.id, {});

const proc = Bun.spawn(cmd, {
  cwd,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: {
    ...(process.env as Record<string, string>),
    ...(config.env ?? {}),
  },
});

const exitCode = await proc.exited;
process.exit(exitCode);
