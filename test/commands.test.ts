import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixturePath, spawnCLI } from "./harness.ts";

// ─── list --json ─────────────────────────────────────────────────

describe("kadai list --json", () => {
  test("outputs valid JSON with correct fields", async () => {
    const session = spawnCLI({
      cwd: fixturePath("basic-repo"),
      args: ["list", "--json"],
    });
    const { exitCode, output } = await session.waitForExit();
    expect(exitCode).toBe(0);

    const actions = JSON.parse(output);
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThan(0);

    // Check that each action has the expected fields
    for (const action of actions) {
      expect(action).toHaveProperty("id");
      expect(action).toHaveProperty("name");
      expect(action).toHaveProperty("runtime");
      expect(typeof action.id).toBe("string");
      expect(typeof action.name).toBe("string");
    }
  });

  test("JSON excludes internal fields", async () => {
    const session = spawnCLI({
      cwd: fixturePath("basic-repo"),
      args: ["list", "--json"],
    });
    const { output } = await session.waitForExit();
    const actions = JSON.parse(output);

    for (const action of actions) {
      expect(action).not.toHaveProperty("filePath");
      expect(action).not.toHaveProperty("addedAt");
      expect(action).not.toHaveProperty("shebang");
    }
  });

  test("includes expected actions from basic-repo", async () => {
    const session = spawnCLI({
      cwd: fixturePath("basic-repo"),
      args: ["list", "--json"],
    });
    const { output } = await session.waitForExit();
    const actions = JSON.parse(output);
    const ids = actions.map((a: { id: string }) => a.id);

    expect(ids).toContain("hello");
    expect(ids).toContain("database/reset");
    expect(ids).toContain("database/migrate");
  });

  test("hidden actions excluded by default", async () => {
    const session = spawnCLI({
      cwd: fixturePath("basic-repo"),
      args: ["list", "--json"],
    });
    const { output } = await session.waitForExit();
    const actions = JSON.parse(output);
    const ids = actions.map((a: { id: string }) => a.id);

    expect(ids).not.toContain("secret-tool");
  });

  test("hidden actions included with --all", async () => {
    const session = spawnCLI({
      cwd: fixturePath("basic-repo"),
      args: ["list", "--json", "--all"],
    });
    const { output } = await session.waitForExit();
    const actions = JSON.parse(output);
    const ids = actions.map((a: { id: string }) => a.id);

    expect(ids).toContain("secret-tool");
  });

  test("exits 1 with error when no .kadai dir", async () => {
    // Use a temp dir so findZcliDir can't find .kadai by searching upward
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-no-dir-"));
    try {
      const session = spawnCLI({
        cwd: tmpDir,
        args: ["list", "--json"],
      });
      const { exitCode, stderr } = await session.waitForExit();
      expect(exitCode).toBe(1);
      expect(stderr).toContain(".kadai");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── run <action-id> ─────────────────────────────────────────────

describe("kadai run <action-id>", () => {
  test("runs hello and outputs greeting", async () => {
    const session = spawnCLI({
      cwd: fixturePath("basic-repo"),
      args: ["run", "hello"],
    });
    const { exitCode, output } = await session.waitForExit();
    expect(exitCode).toBe(0);
    expect(output).toContain("Hello from kadai!");
  });

  test("runs nested action (database/migrate)", async () => {
    const session = spawnCLI({
      cwd: fixturePath("basic-repo"),
      args: ["run", "database/migrate"],
    });
    const { exitCode, output } = await session.waitForExit();
    expect(exitCode).toBe(0);
    expect(output).toContain("Migration complete.");
  });

  test("exits 1 for nonexistent action", async () => {
    const session = spawnCLI({
      cwd: fixturePath("basic-repo"),
      args: ["run", "nonexistent"],
    });
    const { exitCode, stderr } = await session.waitForExit();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("nonexistent");
  });

  test("exits 1 with error when no .kadai dir", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-no-dir-"));
    try {
      const session = spawnCLI({
        cwd: tmpDir,
        args: ["run", "hello"],
      });
      const { exitCode, stderr } = await session.waitForExit();
      expect(exitCode).toBe(1);
      expect(stderr).toContain(".kadai");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("skips confirmation in non-TTY", async () => {
    const session = spawnCLI({
      cwd: fixturePath("basic-repo"),
      args: ["run", "database/reset"],
    });
    const { exitCode, output } = await session.waitForExit();
    expect(exitCode).toBe(0);
    expect(output).toContain("Database reset complete.");
  });
});
