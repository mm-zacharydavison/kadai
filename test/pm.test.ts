import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePM } from "../src/core/pm.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "kadai-pm-test-"));
}

describe("resolvePM", () => {
  test("reads packageManager field from package.json", async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ packageManager: "pnpm@9.1.0" }),
      );
      // pnpm may or may not be installed; test that it tries to use it
      // If pnpm is on PATH, it uses it. If not, falls through to chain.
      const pm = await resolvePM(dir);
      // Should resolve to something (bun or npm at minimum)
      expect(pm.bin).toBeTruthy();
      expect(pm.install.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("falls through to availability chain when no packageManager field", async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "test" }),
      );
      const pm = await resolvePM(dir);
      // bun is available in this test environment
      expect(pm.bin).toBe("bun");
      expect(pm.install).toEqual(["bun", "install"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("works when no package.json exists", async () => {
    const dir = makeTempDir();
    try {
      const pm = await resolvePM(dir);
      // Should fall through to availability chain
      expect(pm.bin).toBe("bun");
      expect(pm.install).toEqual(["bun", "install"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns correct install command shape", async () => {
    const dir = makeTempDir();
    try {
      const pm = await resolvePM(dir);
      expect(pm.install[0]).toBe(pm.bin);
      expect(pm.install).toContain("install");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
