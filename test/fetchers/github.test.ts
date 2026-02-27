import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkGithubUpdate,
  fetchGithubPlugin,
} from "../../src/core/fetchers/github.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "kadai-gh-test-"));
}

describe("fetchGithubPlugin", () => {
  test("clones a public repo and returns commit SHA", async () => {
    const destDir = makeTempDir();
    try {
      const result = await fetchGithubPlugin(
        { github: "octocat/Hello-World", ref: "master" },
        destDir,
      );

      // Should have resolved to a commit SHA (40 hex chars)
      expect(result.resolvedVersion).toMatch(/^[0-9a-f]{40}$/);

      // Files from the repo should exist in destDir
      expect(existsSync(destDir)).toBe(true);
      expect(existsSync(join(destDir, "README"))).toBe(true);
    } finally {
      rmSync(destDir, { recursive: true, force: true });
    }
  }, 30000);

  test("errors gracefully for nonexistent repo", async () => {
    const destDir = makeTempDir();
    try {
      await expect(
        fetchGithubPlugin(
          { github: "nonexistent-user-12345/nonexistent-repo-67890" },
          destDir,
        ),
      ).rejects.toThrow();
    } finally {
      rmSync(destDir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("checkGithubUpdate", () => {
  test("returns true when SHA differs", async () => {
    const hasUpdate = await checkGithubUpdate(
      { github: "octocat/Hello-World", ref: "master" },
      "0000000000000000000000000000000000000000",
    );
    expect(hasUpdate).toBe(true);
  }, 15000);

  test("returns false for nonexistent repo (fails gracefully)", async () => {
    const hasUpdate = await checkGithubUpdate(
      { github: "nonexistent-user-12345/nonexistent-repo-67890" },
      "abc123",
    );
    expect(hasUpdate).toBe(false);
  }, 15000);
});
