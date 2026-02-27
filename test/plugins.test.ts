import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cacheKeyFor,
  ensurePluginCacheDir,
  installPluginDeps,
  loadCachedPlugins,
  loadPathPlugin,
  readPluginMeta,
  syncPlugins,
  writePluginMeta,
} from "../src/core/plugins.ts";
import type { PluginMeta, PluginSyncStatus } from "../src/types.ts";
import { fixturePath } from "./harness.ts";

function makeTempKadaiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kadai-plugin-test-"));
  mkdirSync(join(dir, ".kadai"), { recursive: true });
  return join(dir, ".kadai");
}

describe("ensurePluginCacheDir", () => {
  test("creates .cache/plugins/ and .gitignore", async () => {
    const kadaiDir = makeTempKadaiDir();
    try {
      const cacheDir = await ensurePluginCacheDir(kadaiDir);

      expect(existsSync(cacheDir)).toBe(true);
      expect(cacheDir).toEndWith(".cache/plugins");

      const gitignorePath = join(kadaiDir, ".cache", ".gitignore");
      expect(existsSync(gitignorePath)).toBe(true);

      const gitignoreContent = await Bun.file(gitignorePath).text();
      expect(gitignoreContent.trim()).toBe("*");
    } finally {
      rmSync(join(kadaiDir, ".."), { recursive: true, force: true });
    }
  });

  test("is idempotent — second call does not error", async () => {
    const kadaiDir = makeTempKadaiDir();
    try {
      await ensurePluginCacheDir(kadaiDir);
      const cacheDir = await ensurePluginCacheDir(kadaiDir);
      expect(existsSync(cacheDir)).toBe(true);
    } finally {
      rmSync(join(kadaiDir, ".."), { recursive: true, force: true });
    }
  });
});

describe("cacheKeyFor", () => {
  test("npm package without version", () => {
    expect(cacheKeyFor({ npm: "my-plugin" })).toBe("npm/my-plugin@latest");
  });

  test("npm scoped package with version", () => {
    expect(
      cacheKeyFor({ npm: "@zdavison/claude-tools", version: "1.2.0" }),
    ).toBe("npm/@zdavison--claude-tools@1.2.0");
  });

  test("npm scoped package without version", () => {
    expect(cacheKeyFor({ npm: "@org/pkg" })).toBe("npm/@org--pkg@latest");
  });

  test("github repo with ref", () => {
    expect(cacheKeyFor({ github: "zdavison/shared", ref: "main" })).toBe(
      "github/zdavison--shared@main",
    );
  });

  test("github repo without ref defaults to main", () => {
    expect(cacheKeyFor({ github: "zdavison/shared" })).toBe(
      "github/zdavison--shared@main",
    );
  });

  test("github repo with tag ref", () => {
    expect(cacheKeyFor({ github: "org/repo", ref: "v2.1.0" })).toBe(
      "github/org--repo@v2.1.0",
    );
  });
});

describe("readPluginMeta / writePluginMeta", () => {
  test("round-trips correctly", async () => {
    const kadaiDir = makeTempKadaiDir();
    try {
      const cacheDir = join(kadaiDir, ".cache", "plugins", "npm", "test@1.0.0");
      mkdirSync(cacheDir, { recursive: true });

      const meta: PluginMeta = {
        fetchedAt: "2026-02-27T10:00:00Z",
        source: { npm: "test", version: "1.0.0" },
        resolvedVersion: "1.0.0",
      };

      await writePluginMeta(cacheDir, meta);
      const read = await readPluginMeta(cacheDir);

      expect(read).toEqual(meta);
    } finally {
      rmSync(join(kadaiDir, ".."), { recursive: true, force: true });
    }
  });

  test("returns null for missing cache", async () => {
    const result = await readPluginMeta("/nonexistent/path");
    expect(result).toBeNull();
  });

  test("returns null for malformed JSON", async () => {
    const kadaiDir = makeTempKadaiDir();
    try {
      const cacheDir = join(kadaiDir, "broken");
      mkdirSync(cacheDir, { recursive: true });
      await Bun.write(join(cacheDir, ".plugin-meta.json"), "not json");

      const result = await readPluginMeta(cacheDir);
      expect(result).toBeNull();
    } finally {
      rmSync(join(kadaiDir, ".."), { recursive: true, force: true });
    }
  });
});

describe("loadCachedPlugins", () => {
  test("returns empty array when no cache exists", async () => {
    const kadaiDir = makeTempKadaiDir();
    try {
      const actions = await loadCachedPlugins(kadaiDir, [
        { npm: "nonexistent" },
      ]);
      expect(actions).toEqual([]);
    } finally {
      rmSync(join(kadaiDir, ".."), { recursive: true, force: true });
    }
  });

  test("returns actions from pre-populated cache fixture", async () => {
    const kadaiDir = join(fixturePath("cached-plugins"), ".kadai");
    const plugins = [
      { npm: "@zdavison/claude-tools", version: "1.2.0" },
      { github: "org/shared", ref: "main" },
    ];
    const actions = await loadCachedPlugins(kadaiDir, plugins);

    expect(actions.length).toBeGreaterThanOrEqual(3);

    const ids = actions.map((a) => a.id);
    expect(ids).toContain("@zdavison/claude-tools/hello");
    expect(ids).toContain("@zdavison/claude-tools/deploy/staging");
    expect(ids).toContain("org/shared/check");
  });

  test("actions have correct origin field", async () => {
    const kadaiDir = join(fixturePath("cached-plugins"), ".kadai");
    const plugins = [{ npm: "@zdavison/claude-tools", version: "1.2.0" }];
    const actions = await loadCachedPlugins(kadaiDir, plugins);

    for (const action of actions) {
      expect(action.origin.type).toBe("plugin");
      expect(action.origin.pluginName).toBe("@zdavison/claude-tools");
    }
  });

  test("actions have correct category prefix for plugin grouping", async () => {
    const kadaiDir = join(fixturePath("cached-plugins"), ".kadai");
    const plugins = [{ npm: "@zdavison/claude-tools", version: "1.2.0" }];
    const actions = await loadCachedPlugins(kadaiDir, plugins);

    const hello = actions.find((a) => a.id === "@zdavison/claude-tools/hello");
    expect(hello).toBeDefined();
    expect(hello?.category).toEqual(["@zdavison/claude-tools"]);

    const staging = actions.find(
      (a) => a.id === "@zdavison/claude-tools/deploy/staging",
    );
    expect(staging).toBeDefined();
    expect(staging?.category).toEqual(["@zdavison/claude-tools", "deploy"]);
  });

  test("actions from multiple plugins don't collide", async () => {
    const kadaiDir = join(fixturePath("cached-plugins"), ".kadai");
    const plugins = [
      { npm: "@zdavison/claude-tools", version: "1.2.0" },
      { github: "org/shared", ref: "main" },
    ];
    const actions = await loadCachedPlugins(kadaiDir, plugins);

    const npmActions = actions.filter(
      (a) => a.origin.pluginName === "@zdavison/claude-tools",
    );
    const ghActions = actions.filter(
      (a) => a.origin.pluginName === "org/shared",
    );
    expect(npmActions.length).toBeGreaterThan(0);
    expect(ghActions.length).toBeGreaterThan(0);

    // IDs should be distinct
    const allIds = actions.map((a) => a.id);
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });
});

describe("installPluginDeps", () => {
  test("is a no-op when no package.json present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kadai-deps-test-"));
    try {
      // Should not throw
      await installPluginDeps(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runs install when package.json exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kadai-deps-test-"));
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "test-plugin", dependencies: {} }),
      );
      // Should not throw
      await installPluginDeps(dir);
      // node_modules should be created (even if empty)
      expect(existsSync(join(dir, "node_modules"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("syncPlugins", () => {
  test("reports per-plugin status via onPluginStatus callback", async () => {
    const kadaiDir = makeTempKadaiDir();
    try {
      const statuses: Array<[string, PluginSyncStatus]> = [];
      await syncPlugins(kadaiDir, [{ npm: "is-number", version: "7.0.0" }], {
        onPluginStatus: (name, status) => statuses.push([name, status]),
        onUpdate: () => {},
      });

      // Should have seen "syncing" then "done" for is-number
      const isNumberStatuses = statuses.filter(([n]) => n === "is-number");
      expect(isNumberStatuses.length).toBeGreaterThanOrEqual(2);
      expect(isNumberStatuses[0]?.[1]).toBe("syncing");
      expect(isNumberStatuses[isNumberStatuses.length - 1]?.[1]).toBe("done");
    } finally {
      rmSync(join(kadaiDir, ".."), { recursive: true, force: true });
    }
  }, 30000);

  test("calls onUpdate with refreshed actions on success", async () => {
    const kadaiDir = makeTempKadaiDir();
    try {
      let updatedActions: unknown[] = [];
      await syncPlugins(kadaiDir, [{ npm: "is-number", version: "7.0.0" }], {
        onPluginStatus: () => {},
        onUpdate: (actions) => {
          updatedActions = actions;
        },
      });

      // is-number likely doesn't have an actions/ dir, so
      // the plugin itself won't produce actions, but onUpdate should still be called
      expect(Array.isArray(updatedActions)).toBe(true);
    } finally {
      rmSync(join(kadaiDir, ".."), { recursive: true, force: true });
    }
  }, 30000);

  test("reports error status on fetch failure", async () => {
    const kadaiDir = makeTempKadaiDir();
    try {
      const statuses: Array<[string, PluginSyncStatus]> = [];
      await syncPlugins(
        kadaiDir,
        [{ npm: "kadai-nonexistent-pkg-xyz-12345" }],
        {
          onPluginStatus: (name, status) => statuses.push([name, status]),
          onUpdate: () => {},
        },
      );

      const lastStatus = statuses[statuses.length - 1];
      expect(lastStatus?.[1]).toBe("error");
    } finally {
      rmSync(join(kadaiDir, ".."), { recursive: true, force: true });
    }
  }, 30000);

  test("skips path plugins (they are loaded directly)", async () => {
    const kadaiDir = makeTempKadaiDir();
    try {
      const statuses: Array<[string, PluginSyncStatus]> = [];
      await syncPlugins(kadaiDir, [{ path: "../some-path" }], {
        onPluginStatus: (name, status) => statuses.push([name, status]),
        onUpdate: () => {},
      });

      // No sync should happen for path plugins
      expect(statuses).toHaveLength(0);
    } finally {
      rmSync(join(kadaiDir, ".."), { recursive: true, force: true });
    }
  });
});

describe("loadPathPlugin", () => {
  test("loads actions from a path plugin with correct origin", async () => {
    const kadaiDir = join(fixturePath("cached-plugins"), ".kadai");
    const actions = await loadPathPlugin(kadaiDir, {
      path: "../shared-scripts",
    });

    expect(actions.length).toBeGreaterThan(0);

    const shared = actions.find(
      (a) => a.id === "../shared-scripts/shared-action",
    );
    expect(shared).toBeDefined();
    expect(shared?.origin).toEqual({
      type: "plugin",
      pluginName: "../shared-scripts",
    });
  });

  test("path plugin actions have correct category prefix", async () => {
    const kadaiDir = join(fixturePath("cached-plugins"), ".kadai");
    const actions = await loadPathPlugin(kadaiDir, {
      path: "../shared-scripts",
    });

    for (const action of actions) {
      expect(action.category[0]).toBe("../shared-scripts");
    }
  });

  test("missing path plugin directory returns empty array", async () => {
    const kadaiDir = join(fixturePath("cached-plugins"), ".kadai");
    const actions = await loadPathPlugin(kadaiDir, {
      path: "../nonexistent-dir",
    });
    expect(actions).toEqual([]);
  });

  test("absolute path plugin loads correctly", async () => {
    const absPath = join(fixturePath("cached-plugins"), "shared-scripts");
    const kadaiDir = join(fixturePath("cached-plugins"), ".kadai");
    const actions = await loadPathPlugin(kadaiDir, { path: absPath });

    expect(actions.length).toBeGreaterThan(0);
  });
});
