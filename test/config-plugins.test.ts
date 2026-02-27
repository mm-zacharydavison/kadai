import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadConfig } from "../src/core/config.ts";
import { fixturePath } from "./harness.ts";

describe("config — plugins field", () => {
  test("loads plugins array from config.ts", async () => {
    const kadaiDir = join(fixturePath("plugin-repo"), ".kadai");
    const config = await loadConfig(kadaiDir);

    expect(config.plugins).toBeDefined();
    expect(config.plugins).toHaveLength(4);
  });

  test("npm plugin source parsed correctly", async () => {
    const kadaiDir = join(fixturePath("plugin-repo"), ".kadai");
    const config = await loadConfig(kadaiDir);
    const npmPlugin = config.plugins?.[0];

    expect(npmPlugin).toEqual({ npm: "@zdavison/claude-tools" });
  });

  test("npm plugin with version parsed correctly", async () => {
    const kadaiDir = join(fixturePath("plugin-repo"), ".kadai");
    const config = await loadConfig(kadaiDir);
    const npmPlugin = config.plugins?.[1];

    expect(npmPlugin).toEqual({
      npm: "kadai-devops-scripts",
      version: "^1.0.0",
    });
  });

  test("github plugin source parsed correctly", async () => {
    const kadaiDir = join(fixturePath("plugin-repo"), ".kadai");
    const config = await loadConfig(kadaiDir);
    const ghPlugin = config.plugins?.[2];

    expect(ghPlugin).toEqual({ github: "zdavison/kadai-shared", ref: "main" });
  });

  test("path plugin source parsed correctly", async () => {
    const kadaiDir = join(fixturePath("plugin-repo"), ".kadai");
    const config = await loadConfig(kadaiDir);
    const pathPlugin = config.plugins?.[3];

    expect(pathPlugin).toEqual({ path: "../shared-scripts" });
  });

  test("config without plugins returns plugins: undefined", async () => {
    const kadaiDir = join(fixturePath("basic-repo"), ".kadai");
    const config = await loadConfig(kadaiDir);

    expect(config.plugins).toBeUndefined();
  });
});
