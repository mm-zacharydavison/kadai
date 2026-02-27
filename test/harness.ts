import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..");
const CLI_ENTRY = join(PROJECT_ROOT, "src", "cli.tsx");

// Isolated HOME so tests never pick up the real ~/.kadai/actions/
const TEST_HOME = mkdtempSync(join(tmpdir(), "kadai-test-home-"));

/**
 * Strip ANSI escape codes from a string so we can assert on plain text.
 */
export function stripAnsi(str: string): string {
  return str.replace(
    // Covers CSI sequences, OSC sequences, and single-char escapes
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    "",
  );
}

export const Keys = {
  ENTER: "\r",
  ESCAPE: "\x1b",
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  LEFT: "\x1b[D",
  RIGHT: "\x1b[C",
  CTRL_C: "\x03",
  BACKSPACE: "\x7f",
  TAB: "\t",
} as const;

export interface CLISession {
  /** Block until `text` appears in the stripped stdout output. */
  waitForText(text: string, timeoutMs?: number): Promise<void>;

  /** Block until the process exits. Returns exit code and captured output. */
  waitForExit(timeoutMs?: number): Promise<{
    exitCode: number;
    output: string;
    stderr: string;
  }>;

  /** Send a single key (use Keys constants for special keys). */
  press(key: string): void;

  /** Send a string character-by-character to stdin. */
  type(text: string): void;

  /** Get raw stdout (includes ANSI codes). */
  getOutput(): string;

  /** Get stdout with ANSI codes stripped. */
  getStrippedOutput(): string;

  /** Get raw stderr. */
  getStderr(): string;

  /** Kill the CLI process. Safe to call multiple times. */
  kill(): void;
}

export function spawnCLI(options: {
  cwd: string;
  args?: string[];
  env?: Record<string, string>;
}): CLISession {
  const { cwd, args = [], env } = options;

  let output = "";
  let stderr = "";
  let exitCode: number | null = null;

  const proc = Bun.spawn(["bun", CLI_ENTRY, ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...env,
      HOME: TEST_HOME,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });

  const readStdout = (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value);
      }
    } catch {
      // Process killed or stream closed
    }
  })();

  const readStderr = (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value);
      }
    } catch {
      // Process killed or stream closed
    }
  })();

  proc.exited.then((code) => {
    exitCode = code;
  });

  return {
    async waitForText(text: string, timeoutMs = 5000): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (stripAnsi(output).includes(text)) return;
        // Fail fast if process already exited without producing the text
        if (exitCode !== null) {
          await readStdout;
          await readStderr;
          // Re-check after draining — data may have arrived with the exit
          if (stripAnsi(output).includes(text)) return;
          throw new Error(
            `Process exited (code ${exitCode}) without producing "${text}"\n` +
              `--- stdout ---\n${stripAnsi(output)}\n` +
              `--- stderr ---\n${stderr}`,
          );
        }
        await Bun.sleep(50);
      }
      throw new Error(
        `Timed out waiting for "${text}" after ${timeoutMs}ms\n` +
          `--- stdout ---\n${stripAnsi(output)}\n` +
          `--- stderr ---\n${stderr}`,
      );
    },

    async waitForExit(
      timeoutMs = 10000,
    ): Promise<{ exitCode: number; output: string; stderr: string }> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (exitCode !== null) {
          await readStdout;
          await readStderr;
          return { exitCode, output: stripAnsi(output), stderr };
        }
        await Bun.sleep(50);
      }
      proc.kill();
      throw new Error(
        `Process did not exit within ${timeoutMs}ms\n` +
          `--- stdout ---\n${stripAnsi(output)}\n` +
          `--- stderr ---\n${stderr}`,
      );
    },

    press(key: string): void {
      proc.stdin.write(key);
      proc.stdin.flush();
    },

    type(text: string): void {
      for (const char of text) {
        proc.stdin.write(char);
      }
      proc.stdin.flush();
    },

    getOutput(): string {
      return output;
    },

    getStrippedOutput(): string {
      return stripAnsi(output);
    },

    getStderr(): string {
      return stderr;
    },

    kill(): void {
      try {
        proc.kill();
      } catch {
        // Already dead
      }
    },
  };
}

/** Resolve the absolute path to a test fixture directory. */
export function fixturePath(name: string): string {
  return join(import.meta.dir, "fixtures", name);
}
