import { afterEach, describe, expect, test } from "bun:test";
import { type CLISession, fixturePath, Keys, spawnCLI } from "./harness";

describe("navigation", () => {
  let cli: CLISession;

  afterEach(() => {
    cli?.kill();
  });

  test("starts at root menu", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    // Root menu should show top-level items and categories
    await cli.waitForText("Hello World");
    await cli.waitForText("database");
  });

  test("entering a category shows its actions", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("database");
    // Navigate to database category and enter it
    cli.type("/");
    cli.type("database");
    cli.press(Keys.ENTER);
    // Should now show database actions
    await cli.waitForText("Reset Database");
    await cli.waitForText("Seed Data");
    await cli.waitForText("Run Migrations");
  });

  test("breadcrumbs show current navigation path", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("database");
    cli.type("/");
    cli.type("database");
    cli.press(Keys.ENTER);
    // Breadcrumbs should reflect the path
    await cli.waitForText("xcli");
    await cli.waitForText("database");
  });

  test("escape goes back to parent menu", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("database");
    // Enter database category
    cli.type("/");
    cli.type("database");
    cli.press(Keys.ENTER);
    await cli.waitForText("Reset Database");
    // Press escape to go back
    cli.press(Keys.ESCAPE);
    // Should be back at root with top-level items
    await cli.waitForText("Hello World");
    await cli.waitForText("Cleanup");
  });

  test("escape at root exits the app", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
    cli.press(Keys.ESCAPE);
    const result = await cli.waitForExit();
    expect(result.exitCode).toBe(0);
  });

  test("q exits the app from anywhere", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
    cli.type("q");
    const result = await cli.waitForExit();
    expect(result.exitCode).toBe(0);
  });

  test("selecting an action shows its output", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
    cli.type("/");
    cli.type("Hello World");
    cli.press(Keys.ENTER);
    // Should switch to output screen
    await cli.waitForText("Hello from xcli!");
  });

  test("escape from output screen returns to menu", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
    cli.type("/");
    cli.type("Hello World");
    cli.press(Keys.ENTER);
    await cli.waitForText("Hello from xcli!");
    // Press escape to go back to menu
    cli.press(Keys.ESCAPE);
    await cli.waitForText("Hello World");
    await cli.waitForText("Cleanup");
  });

  test("navigating nested categories works (2 levels)", async () => {
    cli = spawnCLI({ cwd: fixturePath("nested-repo") });
    await cli.waitForText("deploy");
    // Enter deploy
    cli.type("/");
    cli.type("deploy");
    cli.press(Keys.ENTER);
    await cli.waitForText("staging");
    // Enter staging
    cli.type("/");
    cli.type("staging");
    cli.press(Keys.ENTER);
    // Should show the regional deploy scripts
    await cli.waitForText("Deploy US East");
    await cli.waitForText("Deploy EU West");
  });

  test("j/k keys navigate the list", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
    // j should move down, k should move up (vim-style navigation)
    cli.type("j");
    await Bun.sleep(100);
    cli.type("k");
    await Bun.sleep(100);
    // Menu should still be visible (navigation didn't break anything)
    const output = cli.getStrippedOutput();
    expect(output).toContain("Hello World");
  });

  test("arrow keys navigate the list", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
    cli.press(Keys.DOWN);
    await Bun.sleep(100);
    cli.press(Keys.UP);
    await Bun.sleep(100);
    const output = cli.getStrippedOutput();
    expect(output).toContain("Hello World");
  });

  test("n key hint is shown in status bar", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("n new");
  });

  test("pressing n during search types n into search query", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
    // Enter search mode
    cli.type("/");
    await cli.waitForText("/ ");
    // Type 'n' — should add to search query, not trigger generation
    cli.type("n");
    await cli.waitForText("/ n");
  });
});
