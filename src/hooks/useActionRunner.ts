import type { FileSink } from "bun";
import { useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { runAction } from "../core/runner.ts";
import type { Action, KadaiConfig } from "../types.ts";

interface UseActionRunnerOptions {
  action: Action | null;
  cwd: string;
  config?: KadaiConfig;
  enabled?: boolean;
  onRunningChange?: (running: boolean) => void;
}

export function useActionRunner({
  action,
  cwd,
  config,
  enabled = true,
  onRunningChange,
}: UseActionRunnerOptions) {
  const [lines, setLines] = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const doneRef = useRef(false);
  const onRunningChangeRef = useRef(onRunningChange);
  onRunningChangeRef.current = onRunningChange;
  const stdinRef = useRef<FileSink | null>(null);

  // Forward keypresses to the subprocess stdin via Ink's input pipeline.
  // This avoids racing with Ink's own readable-based stdin consumption.
  useInput(
    (input, key) => {
      const stdin = stdinRef.current;
      if (!stdin) return;

      try {
        if (key.return) {
          stdin.write("\n");
        } else if (key.backspace || key.delete) {
          stdin.write("\x7f");
        } else if (key.tab) {
          stdin.write("\t");
        } else if (key.escape) {
          stdin.write("\x1b");
        } else if (key.ctrl && input) {
          // Ctrl+letter → control character (e.g. Ctrl+D → 0x04)
          const code = input.toUpperCase().charCodeAt(0) - 64;
          if (code > 0 && code < 32) {
            stdin.write(String.fromCharCode(code));
          }
        } else if (input) {
          stdin.write(input);
        }
        stdin.flush();
      } catch {
        // Subprocess may have already exited
      }
    },
    { isActive: running },
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on action identity change, not every render
  useEffect(() => {
    if (!action || !enabled) return;

    let aborted = false;

    setLines([]);
    setExitCode(null);
    setRunning(true);
    onRunningChangeRef.current?.(true);
    doneRef.current = false;

    let handle: ReturnType<typeof runAction>;
    try {
      handle = runAction(action, { cwd, config });
    } catch {
      setRunning(false);
      onRunningChangeRef.current?.(false);
      setExitCode(-1);
      doneRef.current = true;
      return;
    }

    stdinRef.current = handle.stdin;

    const readStream = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || aborted) break;
          const text = decoder.decode(value);
          const newLines = text.split("\n").filter((l) => l.length > 0);
          if (newLines.length > 0) {
            setLines((prev) => [...prev, ...newLines]);
          }
        }
      } catch {
        // Stream closed
      }
    };

    readStream(handle.stdout);
    readStream(handle.stderr);

    handle.proc.exited.then((code) => {
      stdinRef.current = null;
      try {
        handle.stdin.end();
      } catch {
        // Already closed
      }
      if (aborted) return;
      setExitCode(code);
      setRunning(false);
      onRunningChangeRef.current?.(false);
      doneRef.current = true;
    });

    return () => {
      aborted = true;
      stdinRef.current = null;
      try {
        handle.stdin.end();
      } catch {
        // Already closed
      }
      onRunningChangeRef.current?.(false);
      try {
        handle.proc.kill();
      } catch {
        // Already dead
      }
    };
  }, [action?.id, cwd, config, enabled]);

  return { lines, exitCode, running, doneRef };
}
