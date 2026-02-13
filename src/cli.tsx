#!/usr/bin/env bun
import { join } from "node:path";
import { Readable } from "node:stream";
import { render } from "ink";
import React from "react";
import { generate } from "./ai/generate.ts";
import { getDefaultProvider } from "./ai/provider.ts";
import { App } from "./app.tsx";
import { InitWizard } from "./components/init-wizard/InitWizard.tsx";
import { loadConfig } from "./core/config.ts";
import { defaultDeps, type InitResult } from "./core/init-wizard.ts";
import { findXcliDir } from "./core/loader.ts";
import type { GenerationResult } from "./types.ts";

const cwd = process.cwd();

let xcliDir = findXcliDir(cwd);
if (!xcliDir) {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "Error: No .xcli directory found. Create a .xcli/actions/ directory to get started.\n",
    );
    process.exit(1);
  }
  const initResult = await new Promise<InitResult>((resolve) => {
    const instance = render(
      React.createElement(InitWizard, {
        cwd,
        deps: defaultDeps(),
        onDone: (result) => {
          instance.unmount();
          resolve(result);
        },
      }),
      { stdout: process.stdout, stderr: process.stderr },
    );
  });
  xcliDir = initResult.xcliDir;
  console.clear();
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

type RenderResult = "exit" | "handover";

function renderInkApp(
  stdinStream: NodeJS.ReadStream,
  opts: {
    generationResult?: GenerationResult;
  },
): Promise<RenderResult> {
  return new Promise((resolve) => {
    let resolved = false;

    const onRequestHandover = () => {
      if (resolved) return;
      resolved = true;
      instance.unmount();
      resolve("handover");
    };

    const instance = render(
      React.createElement(App, {
        cwd,
        xcliDir: xcliDir as string,
        onRequestHandover,
        generationResult: opts.generationResult,
      }),
      {
        stdin: stdinStream,
        stdout: process.stdout,
        stderr: process.stderr,
      },
    );

    instance.waitUntilExit().then(() => {
      if (!resolved) {
        resolved = true;
        resolve("exit");
      }
    });
  });
}

const stdinStream = createStdinStream();

// Main loop: alternate between Ink sessions and external process sessions
let generationResult: GenerationResult | undefined;

while (true) {
  const result = await renderInkApp(stdinStream, {
    generationResult,
  });
  generationResult = undefined;

  if (result === "exit") break;

  if (result === "handover") {
    const provider = getDefaultProvider();
    const available = await provider.isAvailable();

    if (!available) {
      console.log(
        `\n${provider.name} not found. Install the required CLI tool to use AI generation.\n`,
      );
      continue;
    }

    const cfg = await loadConfig(xcliDir);
    const actionsDir = join(xcliDir, cfg.actionsDir ?? "actions");

    // Pause stdin so the parent process doesn't compete with
    // the child process for keystrokes on the shared fd.
    process.stdin.pause();

    const newActions = await generate(provider, xcliDir, actionsDir);

    // Resume stdin so Ink can read from it again.
    process.stdin.resume();

    if (newActions.length > 0) {
      generationResult = { newActions };
    } else {
      console.log("\nNo new actions created.\n");
    }
  }
}

process.exit(0);
