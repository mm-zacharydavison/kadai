import { afterEach, describe, expect, test } from "bun:test";
import { parseShebangCommand, resolveCommand } from "../src/core/runner.ts";
import type { Action } from "../src/types.ts";
import { type CLISession, fixturePath, Keys, spawnCLI } from "./harness";

describe("script execution", () => {
  let cli: CLISession;

  afterEach(() => {
    cli?.kill();
  });

  test("runs a bash script and displays output", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    // Wait for menu, navigate to "Hello World", run it
    await cli.waitForText("Hello World");
    cli.type("/");
    cli.type("Hello World");
    cli.press(Keys.ENTER);
    await cli.waitForText("Hello from kadai!");
  });

  test("runs a typescript script via bun and displays output", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("database");
    // Navigate into database category
    cli.type("/");
    cli.type("database");
    cli.press(Keys.ENTER);
    await cli.waitForText("Reset Database");
    // Select reset (confirm: true, so accept confirmation)
    cli.type("/");
    cli.type("Reset");
    cli.press(Keys.ENTER);
    // Accept confirmation prompt
    await cli.waitForText("Y/n");
    cli.type("y");
    await cli.waitForText("Database reset complete.");
  });

  test("runs a python script and displays output", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("database");
    cli.type("/");
    cli.type("database");
    cli.press(Keys.ENTER);
    await cli.waitForText("Seed Data");
    cli.type("/");
    cli.type("Seed");
    cli.press(Keys.ENTER);
    await cli.waitForText("Seed complete.");
  });

  test("exits with the action's exit code", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
    cli.type("/");
    cli.type("Hello World");
    cli.press(Keys.ENTER);
    await cli.waitForText("Hello from kadai!");
    const { exitCode } = await cli.waitForExit();
    expect(exitCode).toBe(0);
  });

  test("streams output incrementally", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("database");
    cli.type("/");
    cli.type("database");
    cli.press(Keys.ENTER);
    await cli.waitForText("Run Migrations");
    cli.type("/");
    cli.type("Migrations");
    cli.press(Keys.ENTER);
    // Output lines should appear as they're produced
    await cli.waitForText("Checking for pending migrations...");
    await cli.waitForText("Applied 3 migrations.");
    await cli.waitForText("Migration complete.");
  });

  test("prompts for confirmation when action has confirm: true", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("database");
    cli.type("/");
    cli.type("database");
    cli.press(Keys.ENTER);
    await cli.waitForText("Reset Database");
    cli.type("/");
    cli.type("Reset");
    cli.press(Keys.ENTER);
    // Should show confirmation prompt before running
    await cli.waitForText("Y/n");
  });

  test("forwards stdin to running script", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Greeter");
    cli.type("/");
    cli.type("Greeter");
    cli.press(Keys.ENTER);
    await cli.waitForText("What is your name?");
    cli.type("World");
    cli.press(Keys.ENTER);
    await cli.waitForText("Hello, World!");
  });

  test("cancelling confirmation does not run the action", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("database");
    cli.type("/");
    cli.type("database");
    cli.press(Keys.ENTER);
    await cli.waitForText("Reset Database");
    cli.type("/");
    cli.type("Reset");
    cli.press(Keys.ENTER);
    await cli.waitForText("Y/n");
    // Press n to cancel
    cli.type("n");
    // Should return to menu without running the script
    const output = cli.getStrippedOutput();
    expect(output).not.toContain("Dropping database...");
  });
});

describe("shebang parsing", () => {
  const filePath = "/tmp/test-script.sh";

  test("parses #!/usr/bin/env with interpreter", () => {
    const result = parseShebangCommand("#!/usr/bin/env python3", filePath);
    expect(result).toEqual(["python3", filePath]);
  });

  test("parses #!/usr/bin/env -S with multiple args", () => {
    const result = parseShebangCommand("#!/usr/bin/env -S uv run", filePath);
    expect(result).toEqual(["uv", "run", filePath]);
  });

  test("parses absolute path shebang", () => {
    const result = parseShebangCommand("#!/bin/bash", filePath);
    expect(result).toEqual(["/bin/bash", filePath]);
  });

  test("parses absolute path with arguments", () => {
    const result = parseShebangCommand("#!/usr/bin/perl -w", filePath);
    expect(result).toEqual(["/usr/bin/perl", "-w", filePath]);
  });

  test("returns null for undefined shebang", () => {
    const result = parseShebangCommand(undefined, filePath);
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = parseShebangCommand("", filePath);
    expect(result).toBeNull();
  });

  test("returns null for string without #! prefix", () => {
    const result = parseShebangCommand("no shebang here", filePath);
    expect(result).toBeNull();
  });
});

describe("resolveCommand", () => {
  function makeAction(overrides: Partial<Action>): Action {
    return {
      id: "test",
      meta: { name: "Test" },
      filePath: "/tmp/test.sh",
      category: [],
      runtime: "bash",
      origin: { type: "local" },
      ...overrides,
    };
  }

  test("uses shebang when present", () => {
    const cmd = resolveCommand(
      makeAction({
        shebang: "#!/bin/sh",
        runtime: "bash",
        filePath: "/tmp/test.sh",
      }),
    );
    expect(cmd).toEqual(["/bin/sh", "/tmp/test.sh"]);
  });

  test("falls back to runtime chain when no shebang", () => {
    const cmd = resolveCommand(
      makeAction({
        runtime: "bash",
        filePath: "/tmp/test.sh",
      }),
    );
    // Should resolve to bash from the chain
    expect(cmd[cmd.length - 1]).toBe("/tmp/test.sh");
    expect(cmd.length).toBeGreaterThanOrEqual(2);
  });

  test("uses bun for typescript runtime", () => {
    const cmd = resolveCommand(
      makeAction({
        runtime: "bun",
        filePath: "/tmp/test.ts",
      }),
    );
    expect(cmd[0]).toBe("bun");
    expect(cmd).toContain("run");
    expect(cmd[cmd.length - 1]).toBe("/tmp/test.ts");
  });

  test("runs executable directly", () => {
    const cmd = resolveCommand(
      makeAction({
        runtime: "executable",
        filePath: "/tmp/my-binary",
      }),
    );
    expect(cmd).toEqual(["/tmp/my-binary"]);
  });

  test("shebang takes priority over runtime chain", () => {
    const cmd = resolveCommand(
      makeAction({
        shebang: "#!/bin/sh",
        runtime: "bash",
        filePath: "/tmp/test.sh",
      }),
    );
    // Should use /bin/sh from shebang, not bash from chain
    expect(cmd[0]).toBe("/bin/sh");
  });
});

describe("shebang-based execution", () => {
  let cli: CLISession;

  afterEach(() => {
    cli?.kill();
  });

  test("runs .sh with #!/bin/sh shebang instead of bash", async () => {
    cli = spawnCLI({ cwd: fixturePath("shebang-repo") });
    await cli.waitForText("SH Hello");
    cli.type("/");
    cli.type("SH Hello");
    cli.press(Keys.ENTER);
    await cli.waitForText("hello from sh");
  });

  test("runs .sh without shebang using default runtime", async () => {
    cli = spawnCLI({ cwd: fixturePath("shebang-repo") });
    await cli.waitForText("No Shebang");
    cli.type("/");
    cli.type("No Shebang");
    cli.press(Keys.ENTER);
    await cli.waitForText("hello from no-shebang");
  });

  test("runs .py with #!/usr/bin/env python3 shebang", async () => {
    cli = spawnCLI({ cwd: fixturePath("shebang-repo") });
    await cli.waitForText("Custom Python");
    cli.type("/");
    cli.type("Custom Python");
    cli.press(Keys.ENTER);
    await cli.waitForText("hello from python");
  });

  test("runs .ts without shebang using bun", async () => {
    cli = spawnCLI({ cwd: fixturePath("shebang-repo") });
    await cli.waitForText("Bun Default");
    cli.type("/");
    cli.type("Bun Default");
    cli.press(Keys.ENTER);
    await cli.waitForText("hello from bun");
  });
});
