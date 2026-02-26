import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import React from "react";
import { InitWizard } from "../src/components/init-wizard/InitWizard.tsx";
import {
  generateConfigFile,
  type InitResult,
  writeInitFiles,
} from "../src/core/init-wizard.ts";
import { stripAnsi } from "./harness.ts";

// ─── generateConfigFile ───────────────────────────────────────────

describe("generateConfigFile", () => {
  test("generates config with commented-out defaults", () => {
    const config = generateConfigFile();
    expect(config).toContain('// actionsDir: "actions"');
    expect(config).toContain("// env: {}");
  });

  test("generates valid export default syntax", () => {
    const config = generateConfigFile();
    expect(config).toStartWith("export default {");
    expect(config).toEndWith("};\n");
  });
});

// ─── writeInitFiles ──────────────────────────────────────────────

describe("writeInitFiles", () => {
  test("creates actions dir, sample action, and config", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-write-test-"));
    try {
      const result = await writeInitFiles(tmpDir);
      expect(result.sampleCreated).toBe(true);
      expect(existsSync(join(tmpDir, ".kadai", "actions", "hello.sh"))).toBe(
        true,
      );
      expect(existsSync(join(tmpDir, ".kadai", "config.ts"))).toBe(true);

      const content = await Bun.file(
        join(tmpDir, ".kadai", "actions", "hello.sh"),
      ).text();
      expect(content).toContain("Hello from kadai!");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("does not overwrite existing sample action", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-write-test-"));
    try {
      // Create existing sample
      const actionsDir = join(tmpDir, ".kadai", "actions");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(actionsDir, { recursive: true });
      await Bun.write(join(actionsDir, "hello.sh"), "existing content");

      const result = await writeInitFiles(tmpDir);
      expect(result.sampleCreated).toBe(false);

      const content = await Bun.file(join(actionsDir, "hello.sh")).text();
      expect(content).toBe("existing content");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── writeInitFiles — SKILL.md generation ────────────────────────

describe("writeInitFiles SKILL.md", () => {
  test("creates skill when .claude/ directory exists", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-skill-test-"));
    try {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tmpDir, ".claude"), { recursive: true });

      const result = await writeInitFiles(tmpDir);
      expect(result.skillCreated).toBe(true);

      const skillPath = join(tmpDir, ".claude", "skills", "kadai", "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);

      const content = await Bun.file(skillPath).text();
      expect(content).toContain("kadai list --json");
      expect(content).toContain("kadai run");
      expect(content).toContain("## Creating Actions");
      expect(content).toContain(".kadai/actions/");
      expect(content).toContain("kadai:name");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("creates skill when CLAUDE.md exists", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-skill-test-"));
    try {
      await Bun.write(join(tmpDir, "CLAUDE.md"), "# Project");

      const result = await writeInitFiles(tmpDir);
      expect(result.skillCreated).toBe(true);

      const skillPath = join(tmpDir, ".claude", "skills", "kadai", "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("skips skill when no .claude dir or CLAUDE.md", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-skill-test-"));
    try {
      const result = await writeInitFiles(tmpDir);
      expect(result.skillCreated).toBe(false);

      const skillPath = join(tmpDir, ".claude", "skills", "kadai", "SKILL.md");
      expect(existsSync(skillPath)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("does not overwrite existing SKILL.md", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-skill-test-"));
    try {
      // Pre-create the skill file
      const skillDir = join(tmpDir, ".claude", "skills", "kadai");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(skillDir, { recursive: true });
      await Bun.write(join(skillDir, "SKILL.md"), "custom content");

      const result = await writeInitFiles(tmpDir);
      expect(result.skillCreated).toBe(false);

      const content = await Bun.file(join(skillDir, "SKILL.md")).text();
      expect(content).toBe("custom content");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── InitWizard component ────────────────────────────────────────

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("InitWizard", () => {
  test("shows initial message", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-wizard-test-"));
    try {
      const instance = render(
        React.createElement(InitWizard, {
          cwd: tmpDir,
          onDone: () => {},
        }),
      );

      const output = stripAnsi(instance.lastFrame() ?? "");
      expect(output).toContain("No .kadai directory found");

      instance.unmount();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("creates files and calls onDone", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-wizard-test-"));
    let doneResult: InitResult | null = null;

    try {
      const instance = render(
        React.createElement(InitWizard, {
          cwd: tmpDir,
          onDone: (result: InitResult) => {
            doneResult = result;
          },
        }),
      );

      // Wait for async file writing to complete
      await tick(200);

      expect(doneResult).not.toBeNull();
      const result = doneResult as unknown as InitResult;
      expect(result.kadaiDir).toBe(`${tmpDir}/.kadai`);
      expect(existsSync(join(tmpDir, ".kadai", "actions", "hello.sh"))).toBe(
        true,
      );
      expect(existsSync(join(tmpDir, ".kadai", "config.ts"))).toBe(true);

      instance.unmount();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("shows created files and done message", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kadai-wizard-test-"));
    try {
      const instance = render(
        React.createElement(InitWizard, {
          cwd: tmpDir,
          onDone: () => {},
        }),
      );

      await tick(200);

      const output = stripAnsi(instance.lastFrame() ?? "");
      expect(output).toContain("Created .kadai/config.ts");
      expect(output).toContain("Created .kadai/actions/hello.sh");
      expect(output).toContain("Done! Run kadai again to get started.");

      instance.unmount();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
