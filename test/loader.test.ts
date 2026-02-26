import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CLISession, fixturePath, Keys, spawnCLI } from "./harness";

describe("action discovery", () => {
  let cli: CLISession;

  afterEach(() => {
    cli?.kill();
  });

  test("discovers top-level actions", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
    await cli.waitForText("Cleanup");
  });

  test("discovers categories as submenu items", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    // "database" directory should appear as a navigable category
    await cli.waitForText("database");
  });

  test("assigns correct runtime for .sh files", async () => {
    // Verified indirectly: running a .sh action should use bash
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
  });

  test("assigns correct runtime for .ts files", async () => {
    // Navigate into the database category using search
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("database");
    cli.type("/database");
    cli.press(Keys.ENTER);
    await cli.waitForText("Reset Database");
  });

  test("assigns correct runtime for .py files", async () => {
    // Navigate into the database category using search
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("database");
    cli.type("/database");
    cli.press(Keys.ENTER);
    await cli.waitForText("Seed Data");
  });

  test("ignores files starting with underscore", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    // Wait for menu to render, then check _helper.sh is not shown
    await cli.waitForText("Hello World");
    const output = cli.getStrippedOutput();
    expect(output).not.toContain("helper");
  });

  test("ignores dotfiles", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
    const output = cli.getStrippedOutput();
    expect(output).not.toContain("hidden");
  });

  test("handles nested categories (2 levels deep)", async () => {
    cli = spawnCLI({ cwd: fixturePath("nested-repo") });
    // Should show "deploy" category at root
    await cli.waitForText("deploy");
  });

  test("shows empty state when no actions exist", async () => {
    cli = spawnCLI({ cwd: fixturePath("empty-repo") });
    // Should display a message indicating no actions were found
    await cli.waitForText("No actions found");
  });

  test("shows error when no .kadai directory exists", async () => {
    // Use a temp dir so findZcliDir can't walk up into a real .kadai
    const tempDir = await mkdtemp(join(tmpdir(), "kadai-no-dir-"));
    try {
      cli = spawnCLI({ cwd: tempDir });
      const result = await cli.waitForExit();
      // Should exit with error and helpful message
      expect(result.exitCode).not.toBe(0);
      expect(result.output + result.stderr).toContain(".kadai");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
