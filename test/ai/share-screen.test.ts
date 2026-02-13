import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { ShareScreen } from "../../src/components/ShareScreen.tsx";
import type { Action, SourceConfig, XcliConfig } from "../../src/types.ts";
import { stripAnsi } from "../harness.ts";

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: "test-action",
    meta: { name: "Test Action" },
    filePath: "/tmp/.xcli/actions/test-action.sh",
    category: [],
    runtime: "bash",
    ...overrides,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("ShareScreen", () => {
  // --- test-run prompt step ---

  test("shows test-run prompt initially", () => {
    const actions = [makeAction()];

    const { lastFrame } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Test run (1/1)");
    expect(output).toContain("Test Action");
    expect(output).toContain("Press enter to run, s to skip");
  });

  test("pressing s skips test-run to path picker (no sources)", async () => {
    const actions = [makeAction()];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    stdin.write("s");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Destination path:");
  });

  test("pressing s skips test-run to source picker (with sources)", async () => {
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    stdin.write("s");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Share to:");
  });

  test("pressing escape skips test-run to next step", async () => {
    const actions = [makeAction()];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    stdin.write("\x1b");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Destination path:");
  });

  test("test-run shows action counter for multiple actions", () => {
    const actions = [
      makeAction({ id: "a", meta: { name: "Action A" } }),
      makeAction({ id: "b", meta: { name: "Action B" } }),
      makeAction({ id: "c", meta: { name: "Action C" } }),
    ];

    const { lastFrame } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("(1/3)");
    expect(output).toContain("Action A");
  });

  test("test-run prompt shows action description in brackets", () => {
    const actions = [
      makeAction({
        meta: { name: "Deploy", description: "Deploy to staging" },
      }),
    ];

    const { lastFrame } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Deploy");
    expect(output).toContain("(Deploy to staging)");
  });

  // --- org/username from runtime ---

  test("uses runtime GitHub username for default path", async () => {
    const actions = [makeAction()];
    const config: XcliConfig = { org: "acme" };

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        config,
        fetchUsername: async () => "alice",
        onDone: () => {},
      }),
    );

    // Wait for useEffect to resolve
    await tick();

    stdin.write("s");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("actions/@acme/alice");
  });

  test("no username defaults to org-only path", async () => {
    const actions = [makeAction()];
    const config: XcliConfig = { org: "acme" };

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        config,
        fetchUsername: async () => null,
        onDone: () => {},
      }),
    );

    await tick();

    stdin.write("s");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("actions/@acme");
    expect(output).not.toContain("actions/@acme/");
  });

  // --- inline custom path field ---

  test("shows custom path field with placeholder", async () => {
    const actions = [makeAction()];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    stdin.write("s");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("actions/your/path");
  });

  test("typing in custom path field works", async () => {
    const actions = [makeAction()];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    // Skip test-run
    stdin.write("s");
    await tick();

    // Navigate to custom field (no org: actions/ at 0, custom at 1)
    stdin.write("\x1b[B"); // arrow down to custom
    await tick();

    // Type a path
    stdin.write("actions/my/scripts");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("actions/my/scripts");
  });

  test("submitting custom path returns result", async () => {
    let doneResult: unknown;
    const actions = [makeAction()];

    const { stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: (result) => {
          doneResult = result;
        },
      }),
    );

    // Skip test-run
    stdin.write("s");
    await tick();

    // Navigate to custom field (no org: actions/ at 0, custom at 1)
    stdin.write("\x1b[B");
    await tick();

    // Type path and submit
    stdin.write("actions/custom/dir");
    await tick();
    stdin.write("\r");
    await tick();

    expect(doneResult).toEqual({
      source: undefined,
      targetPath: "actions/custom/dir",
    });
  });

  test("backspace in custom field removes characters", async () => {
    const actions = [makeAction()];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    stdin.write("s");
    await tick();

    // Navigate to custom field
    stdin.write("\x1b[B");
    await tick();

    stdin.write("abc");
    await tick();
    stdin.write("\x7f"); // backspace
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("ab");
  });

  // --- default path logic ---

  test("non-org default path is actions/", async () => {
    const actions = [makeAction()];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    stdin.write("s");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("actions");
    expect(output).not.toContain("@");
  });

  test("username without org defaults to actions/", async () => {
    let doneResult: unknown;
    const actions = [makeAction()];

    const { stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        fetchUsername: async () => "alice",
        onDone: (result) => {
          doneResult = result;
        },
      }),
    );

    await tick();
    stdin.write("s");
    await tick();

    // First option is actions/ (root), confirm it
    stdin.write("\r");
    await tick();

    expect(doneResult).toEqual({
      source: undefined,
      targetPath: "actions",
    });
  });

  // --- updated existing tests ---

  test("shows list of new actions", async () => {
    const actions = [
      makeAction({
        id: "deploy/staging",
        meta: { name: "Deploy to Staging", emoji: "🚀" },
        filePath: "/tmp/.xcli/actions/deploy/staging.sh",
        category: ["deploy"],
      }),
      makeAction({
        id: "reset-cache",
        meta: { name: "Reset Cache", emoji: "🗑" },
        filePath: "/tmp/.xcli/actions/reset-cache.ts",
      }),
    ];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    stdin.write("s");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Deploy to Staging");
    expect(output).toContain("Reset Cache");
  });

  test("shows path picker after skipping test-run (no sources)", async () => {
    const actions = [makeAction()];
    const config: XcliConfig = { org: "acme" };

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        config,
        cwd: "/tmp",
        fetchUsername: async () => "alice",
        onDone: () => {},
      }),
    );

    await tick();
    stdin.write("s");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Destination path:");
    expect(output).toContain("actions/@acme/alice");
  });

  test("shows source picker after skipping test-run (with sources)", async () => {
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    stdin.write("s");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Share to:");
    expect(output).toContain("Keep in .xcli");
    expect(output).toContain("myorg/shared-ops");
  });

  test("ESC from path picker (no sources) calls onDone", async () => {
    let doneCalled = false;
    const actions = [makeAction()];

    const { stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        fetchUsername: async () => null,
        onDone: () => {
          doneCalled = true;
        },
      }),
    );

    await tick();
    stdin.write("s"); // skip test-run
    await tick();
    stdin.write("\x1b"); // esc from path picker
    expect(doneCalled).toBe(true);
  });

  test("ESC from source picker calls onDone", async () => {
    let doneCalled = false;
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];

    const { stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        cwd: "/tmp",
        onDone: () => {
          doneCalled = true;
        },
      }),
    );

    stdin.write("s"); // skip test-run
    await tick();
    stdin.write("\x1b"); // esc from source picker
    expect(doneCalled).toBe(true);
  });

  test("confirming default path (no sources) returns path without source", async () => {
    let doneResult: unknown;
    const actions = [makeAction()];
    const config: XcliConfig = { org: "acme" };

    const { stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        config,
        cwd: "/tmp",
        fetchUsername: async () => "alice",
        onDone: (result) => {
          doneResult = result;
        },
      }),
    );

    await tick();
    stdin.write("s"); // skip test-run
    await tick();
    stdin.write("\r"); // confirm default path

    expect(doneResult).toEqual({
      source: undefined,
      targetPath: "actions/@acme/alice",
    });
  });

  test("'Keep in .xcli' goes to path picker", async () => {
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];
    const config: XcliConfig = { org: "acme" };

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        config,
        cwd: "/tmp",
        fetchUsername: async () => "bob",
        onDone: () => {},
      }),
    );

    await tick();
    stdin.write("s"); // skip test-run
    await tick();
    // "Keep in .xcli" is first option, press enter
    stdin.write("\r");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Destination path:");
    expect(output).toContain("actions/@acme/bob");
  });

  test("selecting external source goes to path picker", async () => {
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];
    const config: XcliConfig = { org: "meetsmore" };

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        config,
        cwd: "/tmp",
        fetchUsername: async () => "alice",
        onDone: () => {},
      }),
    );

    await tick();
    stdin.write("s"); // skip test-run
    await tick();
    stdin.write("j");
    await tick();
    stdin.write("\r");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Destination path:");
    expect(output).toContain("actions/@meetsmore/alice");
  });

  test("confirming path after selecting source returns both", async () => {
    let doneResult: unknown;
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];
    const config: XcliConfig = { org: "meetsmore" };

    const { stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        config,
        cwd: "/tmp",
        fetchUsername: async () => "alice",
        onDone: (result) => {
          doneResult = result;
        },
      }),
    );

    await tick();
    stdin.write("s"); // skip test-run
    await tick();
    // Select external source
    stdin.write("j");
    await tick();
    stdin.write("\r");
    await tick();
    // Confirm default path
    stdin.write("\r");
    await tick();

    expect(doneResult).toEqual({
      source: { repo: "myorg/shared-ops" },
      targetPath: "actions/@meetsmore/alice",
    });
  });

  test("default path falls back to actions/ when no org or username", async () => {
    const actions = [makeAction()];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        cwd: "/tmp",
        onDone: () => {},
      }),
    );

    stdin.write("s");
    await tick();

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("actions");
    expect(output).not.toContain("@");
  });

  test("esc from path picker goes back to source picker", async () => {
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];
    const config: XcliConfig = { org: "meetsmore" };

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        config,
        cwd: "/tmp",
        fetchUsername: async () => "alice",
        onDone: () => {},
      }),
    );

    await tick();

    stdin.write("s"); // skip test-run
    await tick();
    await tick();

    // Select "Keep in .xcli" to go to path picker
    stdin.write("\r");
    await tick();

    let output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Destination path:");

    // Esc back to source picker
    stdin.write("\x1b");
    await tick();

    output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Share to:");
  });
});
