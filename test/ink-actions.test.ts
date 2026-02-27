import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadActions } from "../src/core/loader.ts";
import { resolveCommand } from "../src/core/runner.ts";
import type { Action } from "../src/types.ts";
import { type CLISession, fixturePath, Keys, spawnCLI } from "./harness";

describe("ink action discovery", () => {
  test("discovers .tsx files as ink runtime", async () => {
    const actionsDir = join(fixturePath("ink-repo"), ".kadai", "actions");
    const actions = await loadActions(actionsDir);

    const counter = actions.find((a) => a.id === "counter");
    expect(counter).toBeDefined();
    expect(counter?.runtime).toBe("ink");
  });

  test("discovers multiple .tsx actions", async () => {
    const actionsDir = join(fixturePath("ink-repo"), ".kadai", "actions");
    const actions = await loadActions(actionsDir);

    const inkActions = actions.filter((a) => a.runtime === "ink");
    expect(inkActions.length).toBe(3);
  });

  test("extracts metadata from .tsx frontmatter", async () => {
    const actionsDir = join(fixturePath("ink-repo"), ".kadai", "actions");
    const actions = await loadActions(actionsDir);

    const counter = actions.find((a) => a.id === "counter");
    expect(counter?.meta.name).toBe("Counter");
    expect(counter?.meta.description).toBe("A simple counter component");
  });
});

describe("ink runtime in runner", () => {
  function makeAction(overrides: Partial<Action>): Action {
    return {
      id: "test",
      meta: { name: "Test" },
      filePath: "/tmp/test.tsx",
      category: [],
      runtime: "ink",
      origin: { type: "local" },
      ...overrides,
    };
  }

  test("ink runtime falls back to bun run", () => {
    const cmd = resolveCommand(makeAction({}));
    expect(cmd[0]).toBe("bun");
    expect(cmd).toContain("run");
    expect(cmd[cmd.length - 1]).toBe("/tmp/test.tsx");
  });

  test("shebang still takes priority for ink runtime", () => {
    const cmd = resolveCommand(
      makeAction({
        shebang: "#!/usr/bin/env bun",
        filePath: "/tmp/test.tsx",
      }),
    );
    expect(cmd[0]).toBe("bun");
    expect(cmd[cmd.length - 1]).toBe("/tmp/test.tsx");
  });
});

describe("ink action rendering", () => {
  let cli: CLISession;

  afterEach(() => {
    cli?.kill();
  });

  test("shows ink action in menu", async () => {
    cli = spawnCLI({ cwd: fixturePath("ink-repo") });
    await cli.waitForText("Counter");
  });

  test("renders ink component inline when selected", async () => {
    cli = spawnCLI({ cwd: fixturePath("ink-repo") });
    await cli.waitForText("Counter");
    cli.type("/");
    cli.type("Counter");
    cli.press(Keys.ENTER);
    await cli.waitForText("Counter: 0");
  });

  test("ink component responds to input", async () => {
    cli = spawnCLI({ cwd: fixturePath("ink-repo") });
    await cli.waitForText("Counter");
    cli.type("/");
    cli.type("Counter");
    cli.press(Keys.ENTER);
    await cli.waitForText("Counter: 0");
    cli.type("+");
    await cli.waitForText("Counter: 1");
    cli.type("+");
    await cli.waitForText("Counter: 2");
    cli.type("-");
    await cli.waitForText("Counter: 1");
  });

  test("ink component onExit returns to menu", async () => {
    cli = spawnCLI({ cwd: fixturePath("ink-repo") });
    await cli.waitForText("Counter");
    cli.type("/");
    cli.type("Counter");
    cli.press(Keys.ENTER);
    await cli.waitForText("Counter: 0");
    cli.type("q");
    // Should return to menu
    await cli.waitForText("Counter");
    await cli.waitForText("No Default");
  });

  test("shows error for action without default export", async () => {
    cli = spawnCLI({ cwd: fixturePath("ink-repo") });
    await cli.waitForText("No Default");
    cli.type("/");
    cli.type("No Default");
    cli.press(Keys.ENTER);
    await cli.waitForText("does not export a default function");
  });
});
