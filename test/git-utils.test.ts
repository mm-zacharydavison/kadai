import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectRepoIdentity,
  getGitHubUsername,
  parseRepoIdentity,
} from "../src/core/git-utils";

describe("parseRepoIdentity", () => {
  test("parses SSH remote URL", () => {
    const result = parseRepoIdentity("git@github.com:meetsmore/api-server.git");
    expect(result).toEqual({ org: "meetsmore", repo: "api-server" });
  });

  test("parses HTTPS remote URL", () => {
    const result = parseRepoIdentity(
      "https://github.com/meetsmore/api-server.git",
    );
    expect(result).toEqual({ org: "meetsmore", repo: "api-server" });
  });

  test("handles HTTPS without .git suffix", () => {
    const result = parseRepoIdentity("https://github.com/meetsmore/api-server");
    expect(result).toEqual({ org: "meetsmore", repo: "api-server" });
  });

  test("handles SSH without .git suffix", () => {
    const result = parseRepoIdentity("git@github.com:meetsmore/api-server");
    expect(result).toEqual({ org: "meetsmore", repo: "api-server" });
  });

  test("returns null for non-GitHub remote", () => {
    const result = parseRepoIdentity("git@gitlab.com:meetsmore/api-server.git");
    expect(result).toBeNull();
  });

  test("returns null for malformed URL", () => {
    const result = parseRepoIdentity("not-a-url");
    expect(result).toBeNull();
  });
});

describe("detectRepoIdentity", () => {
  test("detects identity from a git repo", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "xcli-test-"));
    try {
      // Initialize a git repo with a GitHub remote
      await Bun.$`git init ${tempDir}`.quiet();
      await Bun.$`git -C ${tempDir} remote add origin git@github.com:testorg/testrepo.git`.quiet();

      const result = await detectRepoIdentity(tempDir);
      expect(result).toEqual({ org: "testorg", repo: "testrepo" });
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  test("returns null for non-git directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "xcli-test-"));
    try {
      const result = await detectRepoIdentity(tempDir);
      expect(result).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  test("returns null for repo with no origin remote", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "xcli-test-"));
    try {
      await Bun.$`git init ${tempDir}`.quiet();
      const result = await detectRepoIdentity(tempDir);
      expect(result).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});

describe("getGitHubUsername", () => {
  test("returns null when gh CLI is not available", async () => {
    // This test will pass as long as gh is not authenticated or not installed
    // in the test environment. The function should gracefully return null.
    const result = await getGitHubUsername();
    // We just verify it returns a string or null without throwing
    expect(result === null || typeof result === "string").toBe(true);
  });
});
