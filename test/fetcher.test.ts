import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitFetcher } from "../src/core/fetcher";
import type { SourceConfig } from "../src/types";

describe("GitFetcher", () => {
  const fetcher = new GitFetcher();
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("writeMeta and readMeta round-trip", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcli-fetcher-"));
    const source: SourceConfig = { repo: "testorg/testrepo", ref: "main" };

    await fetcher.writeMeta(tempDir, source);
    const meta = await fetcher.readMeta(tempDir);

    expect(meta).not.toBeNull();
    const m = meta as NonNullable<typeof meta>;
    expect(m.repo).toBe("testorg/testrepo");
    expect(m.ref).toBe("main");
    expect(m.fetchedAt).toBeTruthy();
    // fetchedAt should be a valid ISO date
    expect(new Date(m.fetchedAt).toISOString()).toBe(m.fetchedAt);
  });

  test("readMeta returns null when no meta file exists", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcli-fetcher-"));
    const meta = await fetcher.readMeta(tempDir);
    expect(meta).toBeNull();
  });

  test("writeMeta uses default ref when not specified", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcli-fetcher-"));
    const source: SourceConfig = { repo: "testorg/testrepo" };

    await fetcher.writeMeta(tempDir, source);
    const meta = await fetcher.readMeta(tempDir);

    expect(meta?.ref).toBe("main"); // meta checked for null above via toBeNull
  });

  test("fetch clones a real public repo", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcli-fetcher-"));
    const source: SourceConfig = {
      repo: "octocat/Hello-World",
      ref: "master",
    };

    await fetcher.fetch(source, tempDir);

    // Should have created files in the dest directory
    const entries = await readdir(tempDir);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContain("README");
  }, 30000);

  test("fetch rejects on invalid repo", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcli-fetcher-"));
    const source: SourceConfig = {
      repo: "nonexistent-org-xyz/nonexistent-repo-xyz",
      ref: "main",
    };

    await expect(fetcher.fetch(source, tempDir)).rejects.toThrow();
  }, 30000);
});
