import type { ActionInput, InputValues } from "../types.ts";

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
