import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { ShareScreen } from "../../src/components/ShareScreen.tsx";
import type { Action, SourceConfig } from "../../src/types.ts";
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

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ShareScreen", () => {
  test("shows list of new actions", () => {
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

    const { lastFrame } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        onDone: () => {},
      }),
    );

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Deploy to Staging");
    expect(output).toContain("Reset Cache");
  });

  test("shows path picker immediately when no sources configured", () => {
    const actions = [makeAction()];

    const { lastFrame } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        org: "acme",
        userName: "alice",
        onDone: () => {},
      }),
    );

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Destination path:");
    expect(output).toContain("actions/@acme/alice");
    expect(output).toContain("Somewhere else...");
  });

  test("shows source picker when sources are configured", () => {
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];

    const { lastFrame } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        onDone: () => {},
      }),
    );

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("Share to:");
    expect(output).toContain("Keep in .xcli");
    expect(output).toContain("myorg/shared-ops");
  });

  test("ESC from path picker (no sources) calls onDone", () => {
    let doneCalled = false;
    const actions = [makeAction()];

    const { stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        onDone: () => {
          doneCalled = true;
        },
      }),
    );

    stdin.write("\x1b");
    expect(doneCalled).toBe(true);
  });

  test("ESC from source picker calls onDone", () => {
    let doneCalled = false;
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];

    const { stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        onDone: () => {
          doneCalled = true;
        },
      }),
    );

    stdin.write("\x1b");
    expect(doneCalled).toBe(true);
  });

  test("confirming default path (no sources) returns path without source", () => {
    let doneResult: unknown;
    const actions = [makeAction()];

    const { stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        org: "acme",
        userName: "alice",
        onDone: (result) => {
          doneResult = result;
        },
      }),
    );

    // Path picker is already showing, confirm default
    stdin.write("\r");

    expect(doneResult).toEqual({
      source: undefined,
      targetPath: "actions/@acme/alice",
    });
  });

  test("'Keep in .xcli' goes to path picker", async () => {
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        org: "acme",
        userName: "bob",
        onDone: () => {},
      }),
    );

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

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        org: "meetsmore",
        userName: "alice",
        onDone: () => {},
      }),
    );

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

    const { stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        org: "meetsmore",
        userName: "alice",
        onDone: (result) => {
          doneResult = result;
        },
      }),
    );

    // Select source
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

  test("default path falls back to actions/ when no org or username", () => {
    const actions = [makeAction()];

    const { lastFrame } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources: [],
        onDone: () => {},
      }),
    );

    const output = stripAnsi(lastFrame() ?? "");
    expect(output).toContain("actions");
    expect(output).not.toContain("@");
  });

  test("esc from path picker goes back to source picker", async () => {
    const actions = [makeAction()];
    const sources: SourceConfig[] = [{ repo: "myorg/shared-ops" }];

    const { lastFrame, stdin } = render(
      React.createElement(ShareScreen, {
        newActions: actions,
        sources,
        org: "meetsmore",
        userName: "alice",
        onDone: () => {},
      }),
    );

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
