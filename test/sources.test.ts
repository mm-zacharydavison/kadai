import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceFetcher } from "../src/core/fetcher";
import {
  cacheSlotName,
  ensureCacheDir,
  loadCachedSources,
  refreshSources,
} from "../src/core/sources";
import type { SourceConfig, SourceMeta } from "../src/types";
import { fixturePath } from "./harness";

describe("cacheSlotName", () => {
  test("generates correct cache directory name", () => {
    expect(cacheSlotName({ repo: "meetsmore/xcli-scripts", ref: "main" })).toBe(
      "meetsmore-xcli-scripts-main",
    );
  });

  test("defaults ref to main", () => {
    expect(cacheSlotName({ repo: "myorg/shared-ops" })).toBe(
      "myorg-shared-ops-main",
    );
  });

  test("handles custom ref", () => {
    expect(cacheSlotName({ repo: "myorg/shared-ops", ref: "v2" })).toBe(
      "myorg-shared-ops-v2",
    );
  });
});

describe("ensureCacheDir", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("creates .cache/sources/ directory and .gitignore", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcli-sources-"));
    await ensureCacheDir(tempDir);

    const entries = await readdir(join(tempDir, ".cache"));
    expect(entries).toContain("sources");
    expect(entries).toContain(".gitignore");

    const gitignore = await Bun.file(
      join(tempDir, ".cache", ".gitignore"),
    ).text();
    expect(gitignore.trim()).toBe("*");
  });

  test("is idempotent", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcli-sources-"));
    await ensureCacheDir(tempDir);
    await ensureCacheDir(tempDir);

    const entries = await readdir(join(tempDir, ".cache"));
    expect(entries).toContain("sources");
  });
});

describe("loadCachedSources", () => {
  test("returns empty array if no cache exists", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "xcli-sources-"));
    try {
      const actions = await loadCachedSources(tempDir, [
        { repo: "testorg/shared-scripts", ref: "main" },
      ]);
      expect(actions).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("loads actions from pre-populated cache", async () => {
    const xcliDir = join(fixturePath("sources-repo"), ".xcli");
    const actions = await loadCachedSources(xcliDir, [
      { repo: "testorg/shared-scripts", ref: "main" },
    ]);

    expect(actions.length).toBe(2);

    const remoteAction = actions.find((a) => a.meta.name === "Remote Action");
    expect(remoteAction).toBeTruthy();
    expect(remoteAction?.source).toEqual({
      type: "github",
      label: "testorg/shared-scripts",
    });
    expect(remoteAction?.id).toBe("testorg/shared-scripts:remote-action");

    const deployAction = actions.find((a) => a.meta.name === "Deploy Staging");
    expect(deployAction).toBeTruthy();
    expect(deployAction?.id).toBe("testorg/shared-scripts:deploy/staging");
    expect(deployAction?.category).toEqual(["deploy"]);
  });

  test("skips sources with no cached data", async () => {
    const xcliDir = join(fixturePath("sources-repo"), ".xcli");
    const actions = await loadCachedSources(xcliDir, [
      { repo: "testorg/shared-scripts", ref: "main" },
      { repo: "nonexistent/repo", ref: "main" },
    ]);

    // Should only return actions from the source that has cached data
    expect(actions.length).toBe(2);
    expect(
      actions.every((a) => a.source?.label === "testorg/shared-scripts"),
    ).toBe(true);
  });
});

describe("refreshSources", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("uses mock fetcher to refresh sources", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcli-sources-"));
    await ensureCacheDir(tempDir);

    // Create a mock fetcher that writes a simple action file
    const mockFetcher: SourceFetcher = {
      async fetch(_source: SourceConfig, destDir: string) {
        const actionsDir = join(destDir, "actions");
        await mkdir(actionsDir, { recursive: true });
        await writeFile(
          join(actionsDir, "mock-action.sh"),
          '#!/bin/bash\n# xcli:name Mock Action\necho "mock"',
        );
      },
      async readMeta() {
        return null;
      },
      async writeMeta(destDir: string, source: SourceConfig) {
        const meta: SourceMeta = {
          fetchedAt: new Date().toISOString(),
          repo: source.repo,
          ref: source.ref ?? "main",
        };
        await Bun.write(
          join(destDir, ".source-meta.json"),
          JSON.stringify(meta),
        );
      },
    };

    const sources: SourceConfig[] = [
      { repo: "mockorg/mock-repo", ref: "main" },
    ];

    let updatedActions: Awaited<ReturnType<typeof loadCachedSources>> = [];

    await refreshSources(
      tempDir,
      sources,
      (actions) => {
        updatedActions = actions;
      },
      mockFetcher,
    );

    expect(updatedActions.length).toBe(1);
    expect(updatedActions[0]?.meta.name).toBe("Mock Action");
    expect(updatedActions[0]?.source).toEqual({
      type: "github",
      label: "mockorg/mock-repo",
    });
  });

  test("calls onUpdate even when fetch fails", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcli-sources-"));
    await ensureCacheDir(tempDir);

    const failingFetcher: SourceFetcher = {
      async fetch() {
        throw new Error("Network error");
      },
      async readMeta() {
        return null;
      },
      async writeMeta() {},
    };

    let callCount = 0;
    await refreshSources(
      tempDir,
      [{ repo: "fail/repo", ref: "main" }],
      () => {
        callCount++;
      },
      failingFetcher,
    );

    // onUpdate should still be called (with whatever cached data exists — empty)
    expect(callCount).toBe(1);
  });
});
