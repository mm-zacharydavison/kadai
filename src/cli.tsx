#!/usr/bin/env bun
import { parseArgs } from "./core/args.ts";
import { handleList, handleRun } from "./core/commands.ts";
import { findXcliDir } from "./core/loader.ts";

const cwd = process.cwd();
const parsed = parseArgs(process.argv.slice(2));

if (parsed.type === "error") {
  process.stderr.write(`${parsed.message}\n`);
  process.exit(1);
}

if (parsed.type === "list" || parsed.type === "run") {
  const xcliDir = findXcliDir(cwd);
  if (!xcliDir) {
    process.stderr.write(
      "Error: No .xcli directory found. Run xcli to initialize.\n",
    );
    process.exit(1);
  }
  if (parsed.type === "list") {
    await handleList({ xcliDir, all: parsed.all });
  } else {
    await handleRun({ xcliDir, actionId: parsed.actionId, cwd });
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

const xcliDir = findXcliDir(cwd);
if (!xcliDir) {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "Error: No .xcli directory found. Create a .xcli/actions/ directory to get started.\n",
    );
    process.exit(1);
  }
  const { writeInitFiles } = await import("./core/init-wizard.ts");
  console.log("No .xcli directory found. Setting one up.\n");
  const result = await writeInitFiles(cwd);
  console.log("  Created .xcli/config.ts");
  if (result.sampleCreated) console.log("  Created .xcli/actions/hello.sh");
  if (result.skillCreated)
    console.log("  Created .claude/skills/xcli/SKILL.md");
  console.log("\nDone! Run xcli again to get started.");
  process.exit(0);
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

let pendingInteractiveAction: Action | null = null;

// Loop: render TUI → run interactive action → re-render TUI
while (true) {
  pendingInteractiveAction = null;
  const stdinStream = createStdinStream();

  const instance = render(
    React.createElement(App, {
      cwd,
      xcliDir,
      onRunInteractive: (action: Action) => {
        pendingInteractiveAction = action;
      },
    }),
    {
      stdin: stdinStream,
      stdout: process.stdout,
      stderr: process.stderr,
    },
  );

  await instance.waitUntilExit();

  if (!pendingInteractiveAction) break;

  // Run the interactive action with full stdio passthrough
  // TS narrows to `never` after the break because it can't see the callback mutation
  const action: Action = pendingInteractiveAction;
  const config = await loadConfig(xcliDir);
  const cmd = resolveCommand(action);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(config.env ?? {}),
  };

  console.log(
    `${action.meta.emoji ? `${action.meta.emoji} ` : ""}${action.meta.name}\n`,
  );

  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env,
  });

  const exitCode = await proc.exited;
  const color = exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
  const symbol = exitCode === 0 ? "✓" : "✗";
  console.log(`\n${color}${symbol} exit code ${exitCode}\x1b[0m`);
  console.log("\nPress enter to return to menu...");

  // Wait for user to press enter before re-rendering the TUI
  await new Promise<void>((resolve) => {
    const onData = () => {
      process.stdin.removeListener("data", onData);
      resolve();
    };
    process.stdin.on("data", onData);
  });
}

process.exit(0);
