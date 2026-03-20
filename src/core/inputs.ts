import type { ActionInput, InputValues } from "../types.ts";

/**
 * Run a process while recording stdin line by line.
 * Each line the script reads is captured, mapped to declared inputs by ordinal,
 * and returned after the process exits. Used for --rerun replay.
 *
 * Falls back to stdin: "inherit" (no recording) when stdin is not a TTY.
 */
export async function runWithStdinRecording(
  cmd: string[],
  opts: { cwd: string; env: Record<string, string>; inputs: ActionInput[] },
): Promise<{ exitCode: number; values: InputValues }> {
  if (!process.stdin.isTTY) {
    const proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: opts.env,
    });
    return { exitCode: await proc.exited, values: {} };
  }

  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "pipe",
    env: opts.env,
  });

  const lines: string[] = [];
  let currentLine = "";

  process.stdin.setRawMode(true);
  process.stdin.resume();

  const onData = (chunk: Buffer) => {
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i] as number;
      const char = String.fromCharCode(byte);

      if (char === "\r" || char === "\n") {
        lines.push(currentLine);
        process.stdout.write("\r\n");
        proc.stdin!.write(`${currentLine}\n`);
        proc.stdin!.flush();
        currentLine = "";
      } else if (byte === 0x7f || byte === 0x08) {
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (byte === 0x03) {
        proc.kill("SIGINT");
      } else if (byte === 0x04) {
        if (currentLine.length > 0) {
          lines.push(currentLine);
          proc.stdin!.write(currentLine);
          proc.stdin!.flush();
          currentLine = "";
        }
        proc.stdin!.end();
      } else if (byte >= 0x20) {
        currentLine += char;
        process.stdout.write(char);
      }
    }
  };

  process.stdin.on("data", onData);
  const exitCode = await proc.exited;
  process.stdin.removeListener("data", onData);
  process.stdin.setRawMode(false);
  process.stdin.pause();

  const values: InputValues = {};
  for (let i = 0; i < opts.inputs.length && i < lines.length; i++) {
    const input = opts.inputs[i]!;
    const line = lines[i]!;
    if (input.type === "boolean") {
      const lower = line.toLowerCase();
      values[input.name] = lower === "y" || lower === "yes" || lower === "true" || line === "1";
    } else if (input.type === "number") {
      values[input.name] = Number(line);
    } else {
      values[input.name] = line;
    }
  }

  return { exitCode, values };
}

/**
 * Build env vars and stdin preamble from declared inputs and their collected values.
 * Values are injected as KADAI_INPUT_<NAME> env vars and prepended to stdin
 * in declaration order so scripts using `read`/`input()`/`gets` receive them.
 */
export function buildInjection(
  inputs: ActionInput[],
  values: InputValues,
): { env: Record<string, string>; stdinPreamble: string } {
  const env: Record<string, string> = {};
  const lines: string[] = [];

  for (const input of inputs) {
    const value = values[input.name];
    if (value === undefined) continue;
    env[`KADAI_INPUT_${input.name.toUpperCase()}`] = String(value);
    lines.push(String(value));
  }

  return {
    env,
    stdinPreamble: lines.length > 0 ? `${lines.join("\n")}\n` : "",
  };
}

/**
 * Return a copy of values with sensitive inputs removed.
 * Used before saving to .last-action so secrets are never persisted.
 */
export function filterSensitiveInputs(
  inputs: ActionInput[],
  values: InputValues,
): InputValues {
  const filtered: InputValues = {};
  for (const input of inputs) {
    if (!input.sensitive && values[input.name] !== undefined) {
      filtered[input.name] = values[input.name] as string | boolean | number;
    }
  }
  return filtered;
}

/**
 * Build a ReadableStream that emits the preamble bytes then closes.
 * Used as stdin when input values need to be pre-fed to the script.
 */
export function buildStdinStream(preamble: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (preamble) {
        controller.enqueue(new TextEncoder().encode(preamble));
      }
      controller.close();
    },
  });
}
