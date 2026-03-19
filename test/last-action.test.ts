import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveLastAction, loadLastAction } from "../src/core/last-action.ts";

function makeTmpKadai(): { kadaiDir: string; cleanup: () => void } {
  const tmpDir = mkdtempSync(join(tmpdir(), "kadai-gitignore-"));
  const kadaiDir = join(tmpDir, ".kadai");
  // saveLastAction will write into kadaiDir, but the dir must exist
  const { mkdirSync } = require("node:fs");
  mkdirSync(kadaiDir, { recursive: true });
  return {
    kadaiDir,
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
  };
}

describe("saveLastAction", () => {
  test("writes action id to .last-action", async () => {
    const { kadaiDir, cleanup } = makeTmpKadai();
    try {
      await saveLastAction(kadaiDir, "hello");
      const content = readFileSync(join(kadaiDir, ".last-action"), "utf8").trim();
      expect(content).toBe("hello");
    } finally {
      cleanup();
    }
  });
});

describe("loadLastAction", () => {
  test("returns null when .last-action does not exist", async () => {
    const { kadaiDir, cleanup } = makeTmpKadai();
    try {
      expect(await loadLastAction(kadaiDir)).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("returns action id from .last-action", async () => {
    const { kadaiDir, cleanup } = makeTmpKadai();
    try {
      await Bun.write(join(kadaiDir, ".last-action"), "database/reset");
      expect(await loadLastAction(kadaiDir)).toBe("database/reset");
    } finally {
      cleanup();
    }
  });
});

describe(".gitignore for .last-action", () => {
  test("creates .gitignore with .last-action when it does not exist", async () => {
    const { kadaiDir, cleanup } = makeTmpKadai();
    try {
      await saveLastAction(kadaiDir, "hello");

      const gitignorePath = join(kadaiDir, ".gitignore");
      const content = readFileSync(gitignorePath, "utf8");
      expect(content).toContain(".last-action");
    } finally {
      cleanup();
    }
  });

  test("appends .last-action to existing .gitignore that lacks it", async () => {
    const { kadaiDir, cleanup } = makeTmpKadai();
    try {
      const gitignorePath = join(kadaiDir, ".gitignore");
      await Bun.write(gitignorePath, "node_modules\n.env\n");

      await saveLastAction(kadaiDir, "hello");

      const content = readFileSync(gitignorePath, "utf8");
      expect(content).toContain("node_modules");
      expect(content).toContain(".env");
      expect(content).toContain(".last-action");
    } finally {
      cleanup();
    }
  });

  test("does not duplicate .last-action in .gitignore if already present", async () => {
    const { kadaiDir, cleanup } = makeTmpKadai();
    try {
      const gitignorePath = join(kadaiDir, ".gitignore");
      await Bun.write(gitignorePath, ".last-action\n");

      await saveLastAction(kadaiDir, "hello");

      const content = readFileSync(gitignorePath, "utf8");
      const matches = content.split("\n").filter((line: string) => line.trim() === ".last-action");
      expect(matches.length).toBe(1);
    } finally {
      cleanup();
    }
  });
});
