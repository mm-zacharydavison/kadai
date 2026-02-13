import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { useActionRunner } from "../src/hooks/useActionRunner.ts";
import type { Action } from "../src/types.ts";

const makeAction = (id = "test"): Action => ({
  id,
  meta: { name: "Test Action" },
  filePath: "/tmp/test.sh",
  category: [],
  runtime: "bash",
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("useActionRunner", () => {
  test("starts with empty state when no action provided", () => {
    let lines: string[] | undefined;
    let exitCode: number | null | undefined;
    let running: boolean | undefined;

    function Wrapper() {
      const result = useActionRunner({ action: null, cwd: "/tmp" });
      lines = result.lines;
      exitCode = result.exitCode;
      running = result.running;
      return React.createElement(Text, null, "test");
    }

    render(React.createElement(Wrapper));

    expect(lines).toEqual([]);
    expect(exitCode).toBeNull();
    expect(running).toBe(false);
  });

  test("does not run when enabled=false", async () => {
    let lines: string[] = [];
    let running = false;

    function Wrapper() {
      const result = useActionRunner({
        action: makeAction(),
        cwd: "/tmp",
        enabled: false,
      });
      lines = result.lines;
      running = result.running;
      return React.createElement(Text, null, "test");
    }

    render(React.createElement(Wrapper));
    await tick();

    expect(lines).toEqual([]);
    expect(running).toBe(false);
  });
});
