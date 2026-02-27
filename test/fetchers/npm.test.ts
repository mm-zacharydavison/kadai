import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkNpmUpdate, fetchNpmPlugin } from "../../src/core/fetchers/npm.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "kadai-npm-test-"));
}

describe("fetchNpmPlugin", () => {
  test("downloads and extracts a real npm package", async () => {
    const destDir = makeTempDir();
    try {
      const result = await fetchNpmPlugin({ npm: "is-number" }, destDir);

      // Should have resolved to a version
      expect(result.resolvedVersion).toMatch(/^\d+\.\d+\.\d+/);

      // The package files should exist in destDir
      expect(existsSync(destDir)).toBe(true);
      expect(existsSync(join(destDir, "package.json"))).toBe(true);
    } finally {
      rmSync(destDir, { recursive: true, force: true });
    }
  }, 30000);

  test("resolves specific version when pinned", async () => {
    const destDir = makeTempDir();
    try {
      const result = await fetchNpmPlugin(
        { npm: "is-number", version: "7.0.0" },
        destDir,
      );
      expect(result.resolvedVersion).toBe("7.0.0");
    } finally {
      rmSync(destDir, { recursive: true, force: true });
    }
  }, 30000);

  test("errors gracefully for nonexistent package", async () => {
    const destDir = makeTempDir();
    try {
      await expect(
        fetchNpmPlugin(
          { npm: "kadai-this-package-definitely-does-not-exist-12345" },
          destDir,
        ),
      ).rejects.toThrow();
    } finally {
      rmSync(destDir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("checkNpmUpdate", () => {
  test("returns true when newer version available", async () => {
    // is-number has versions > 1.0.0
    const hasUpdate = await checkNpmUpdate({ npm: "is-number" }, "1.0.0");
    expect(hasUpdate).toBe(true);
  }, 15000);

  test("returns false when at latest version", async () => {
    // First resolve what latest is, then check with that version
    const hasUpdate = await checkNpmUpdate(
      { npm: "is-number", version: "7.0.0" },
      "7.0.0",
    );
    expect(hasUpdate).toBe(false);
  }, 15000);
});
