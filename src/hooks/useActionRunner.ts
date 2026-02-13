import { useEffect, useRef, useState } from "react";
import { runAction } from "../core/runner.ts";
import type { Action, XcliConfig } from "../types.ts";

interface UseActionRunnerOptions {
  action: Action | null;
  cwd: string;
  config?: XcliConfig;
  enabled?: boolean;
}

export function useActionRunner({
  action,
  cwd,
  config,
  enabled = true,
}: UseActionRunnerOptions) {
  const [lines, setLines] = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const doneRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on action identity change, not every render
  useEffect(() => {
    if (!action || !enabled) return;

    let aborted = false;

    setLines([]);
    setExitCode(null);
    setRunning(true);
    doneRef.current = false;

    let handle: ReturnType<typeof runAction>;
    try {
      handle = runAction(action, { cwd, config });
    } catch {
      setRunning(false);
      setExitCode(-1);
      doneRef.current = true;
      return;
    }

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
      if (aborted) return;
      setExitCode(code);
      setRunning(false);
      doneRef.current = true;
    });

    return () => {
      aborted = true;
      try {
        handle.proc.kill();
      } catch {
        // Already dead
      }
    };
  }, [action?.id, cwd, config, enabled]);

  return { lines, exitCode, running, doneRef };
}
