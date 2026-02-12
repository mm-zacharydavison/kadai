import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import React from "react";
import { InitWizard } from "../src/components/InitWizard.tsx";
import {
  createXcliActionsRepo,
  detectAiCli,
  detectXcliActionsRepo,
  generateConfigFile,
  type InitDeps,
  type InitResult,
  validateRepo,
  writeInitFiles,
} from "../src/core/init-wizard.ts";
import { stripAnsi } from "./harness.ts";

function makeDeps(overrides: Partial<InitDeps> = {}): InitDeps {
  return {
    ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "not found" }),
    ghRepoCreate: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
    bunWhich: () => null,
    ...overrides,
  };
}

describe("detectXcliActionsRepo", () => {
  test("finds repo for org", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/meetsmore/xcli-actions") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "meetsmore/xcli-actions",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "not found" };
      },
    });

    const result = await detectXcliActionsRepo("meetsmore", deps);
    expect(result).toEqual({
      repo: "meetsmore/xcli-actions",
      defaultBranch: "main",
    });
  });

  test("finds repo for personal user", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/zack/xcli-actions") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "zack/xcli-actions",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "not found" };
      },
    });

    const result = await detectXcliActionsRepo("zack", deps);
    expect(result).toEqual({
      repo: "zack/xcli-actions",
      defaultBranch: "main",
    });
  });

  test("returns null when no repo exists", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "Not Found" }),
    });

    const result = await detectXcliActionsRepo("meetsmore", deps);
    expect(result).toBeNull();
  });

  test("returns null when gh not installed", async () => {
    const deps = makeDeps({
      ghApi: async () => {
        throw new Error("gh: command not found");
      },
    });

    const result = await detectXcliActionsRepo("meetsmore", deps);
    expect(result).toBeNull();
  });

  test("returns correct default branch", async () => {
    const deps = makeDeps({
      ghApi: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          full_name: "meetsmore/xcli-actions",
          default_branch: "master",
        }),
        stderr: "",
      }),
    });

    const result = await detectXcliActionsRepo("meetsmore", deps);
    expect(result).toEqual({
      repo: "meetsmore/xcli-actions",
      defaultBranch: "master",
    });
  });
});

describe("detectAiCli", () => {
  test("returns true when claude found", async () => {
    const deps = makeDeps({ bunWhich: () => "/usr/local/bin/claude" });
    const result = await detectAiCli(deps);
    expect(result).toBe(true);
  });

  test("returns false when none found", async () => {
    const deps = makeDeps({ bunWhich: () => null });
    const result = await detectAiCli(deps);
    expect(result).toBe(false);
  });
});

describe("validateRepo", () => {
  test("returns valid with default branch", async () => {
    const deps = makeDeps({
      ghApi: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          full_name: "meetsmore/xcli-actions",
          default_branch: "main",
        }),
        stderr: "",
      }),
    });

    const result = await validateRepo("meetsmore/xcli-actions", deps);
    expect(result).toEqual({ valid: true, defaultBranch: "main" });
  });

  test("returns invalid for missing repo", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "Not Found" }),
    });

    const result = await validateRepo("meetsmore/nope", deps);
    expect(result).toEqual({ valid: false });
  });
});

describe("createXcliActionsRepo", () => {
  test("succeeds", async () => {
    const deps = makeDeps({
      ghRepoCreate: async () => ({
        exitCode: 0,
        stdout: "https://github.com/meetsmore/xcli-actions",
        stderr: "",
      }),
      ghApi: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          full_name: "meetsmore/xcli-actions",
          default_branch: "main",
        }),
        stderr: "",
      }),
    });

    const result = await createXcliActionsRepo("meetsmore", deps);
    expect(result).toEqual({
      success: true,
      repo: "meetsmore/xcli-actions",
      defaultBranch: "main",
    });
  });

  test("fails with permission error", async () => {
    const deps = makeDeps({
      ghRepoCreate: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "HTTP 403: permission denied",
      }),
    });

    const result = await createXcliActionsRepo("meetsmore", deps);
    expect(result).toEqual({ success: false, permissionError: true });
  });

  test("fails with other error", async () => {
    const deps = makeDeps({
      ghRepoCreate: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "network error",
      }),
    });

    const result = await createXcliActionsRepo("meetsmore", deps);
    expect(result).toEqual({ success: false, permissionError: false });
  });
});

// ─── generateConfigFile ───────────────────────────────────────────

describe("generateConfigFile", () => {
  test("sources configured, AI enabled", () => {
    const config = generateConfigFile({
      sources: [{ repo: "meetsmore/xcli-actions" }],
      aiEnabled: true,
    });
    expect(config).toContain('repo: "meetsmore/xcli-actions"');
    expect(config).toContain("// ai: { enabled: true }");
    expect(config).not.toContain("ai: { enabled: false }");
  });

  test("no sources, AI disabled", () => {
    const config = generateConfigFile({
      sources: [],
      aiEnabled: false,
    });
    expect(config).toContain("ai: { enabled: false }");
    expect(config).toContain("// sources: []");
  });

  test("all defaults (no sources, AI enabled)", () => {
    const config = generateConfigFile({
      sources: [],
      aiEnabled: true,
    });
    expect(config).toContain("// sources: []");
    expect(config).toContain("// ai: { enabled: true }");
    expect(config).toContain('// actionsDir: "actions"');
  });

  test("omits ref when default branch is main", () => {
    const config = generateConfigFile({
      sources: [{ repo: "meetsmore/xcli-actions" }],
      aiEnabled: true,
    });
    expect(config).not.toContain("ref:");
  });

  test("includes ref when default branch is not main", () => {
    const config = generateConfigFile({
      sources: [{ repo: "meetsmore/xcli-actions", ref: "master" }],
      aiEnabled: true,
    });
    expect(config).toContain('ref: "master"');
  });
});

// ─── writeInitFiles ──────────────────────────────────────────────

describe("writeInitFiles", () => {
  test("creates actions dir, sample action, and config", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xcli-write-test-"));
    try {
      const result = await writeInitFiles(tmpDir, [], false);
      expect(result.sampleCreated).toBe(true);
      expect(existsSync(join(tmpDir, ".xcli", "actions", "hello.sh"))).toBe(
        true,
      );
      expect(existsSync(join(tmpDir, ".xcli", "config.ts"))).toBe(true);

      const content = await Bun.file(
        join(tmpDir, ".xcli", "actions", "hello.sh"),
      ).text();
      expect(content).toContain("Hello from xcli!");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("does not overwrite existing sample action", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xcli-write-test-"));
    try {
      // Create existing sample
      const actionsDir = join(tmpDir, ".xcli", "actions");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(actionsDir, { recursive: true });
      await Bun.write(join(actionsDir, "hello.sh"), "existing content");

      const result = await writeInitFiles(tmpDir, [], false);
      expect(result.sampleCreated).toBe(false);

      const content = await Bun.file(join(actionsDir, "hello.sh")).text();
      expect(content).toBe("existing content");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("writes config with sources", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xcli-write-test-"));
    try {
      await writeInitFiles(tmpDir, [{ repo: "meetsmore/xcli-actions" }], true);
      const configContent = await Bun.file(
        join(tmpDir, ".xcli", "config.ts"),
      ).text();
      expect(configContent).toContain('repo: "meetsmore/xcli-actions"');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── InitWizard component (orchestration) ────────────────────────

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function renderWizard(opts: { deps: InitDeps; gitOrg?: string }) {
  const tmpDir = mkdtempSync(join(tmpdir(), "xcli-wizard-test-"));
  let doneResult: InitResult | null = null;

  const detectRepoIdentity = async () =>
    opts.gitOrg ? { org: opts.gitOrg } : null;

  const instance = render(
    React.createElement(InitWizard, {
      cwd: tmpDir,
      deps: opts.deps,
      detectRepoIdentity,
      onDone: (result: InitResult) => {
        doneResult = result;
      },
    }),
  );

  return {
    ...instance,
    tmpDir,
    getResult: () => doneResult,
    getOutput: () => stripAnsi(instance.lastFrame() ?? ""),
  };
}

describe("InitWizard", () => {
  test("shows spinner during detection", () => {
    // Use deps that never resolve to keep it in detecting phase
    const deps = makeDeps({
      ghApi: () => new Promise(() => {}),
    });

    const { getOutput, unmount, tmpDir } = renderWizard({
      deps,
      gitOrg: "meetsmore",
    });

    const output = getOutput();
    expect(output).toContain("No .xcli directory found");
    expect(output).toContain("Detecting environment");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("suggests detected xcli-actions repo and user accepts", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/meetsmore/xcli-actions") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "meetsmore/xcli-actions",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => "/usr/local/bin/claude",
    });

    const { stdin, getOutput, getResult, tmpDir } = renderWizard({
      deps,
      gitOrg: "meetsmore",
    });

    await tick();
    const output = getOutput();
    expect(output).toContain("Detected a shared actions repo");
    expect(output).toContain("meetsmore/xcli-actions");

    // Accept recommended repo
    stdin.write("\r");
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.sources).toEqual([{ repo: "meetsmore/xcli-actions" }]);
    expect(result?.aiEnabled).toBe(true);
    expect(existsSync(join(tmpDir, ".xcli", "actions", "hello.sh"))).toBe(true);
    expect(existsSync(join(tmpDir, ".xcli", "config.ts"))).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("silently enables AI when claude installed", async () => {
    const deps = makeDeps({
      bunWhich: () => "/usr/local/bin/claude",
    });

    const { stdin, getOutput, getResult, tmpDir } = renderWizard({
      deps,
      gitOrg: undefined,
    });

    await tick();
    // No git remote: shows "Do you have a shared xcli actions repo?"
    const output = getOutput();
    expect(output).toContain("Do you have a shared xcli actions repo?");

    // "No, just use local"
    stdin.write("\x1b[B"); // down arrow
    await tick();
    stdin.write("\r");
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.aiEnabled).toBe(true);
    const doneOutput = getOutput();
    expect(doneOutput).toContain("AI generation enabled");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("silently disables AI when no CLI found", async () => {
    const deps = makeDeps({
      bunWhich: () => null,
    });

    const { stdin, getOutput, getResult, tmpDir } = renderWizard({
      deps,
      gitOrg: undefined,
    });

    await tick();

    // "No, just use local"
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.aiEnabled).toBe(false);
    const doneOutput = getOutput();
    expect(doneOutput).not.toContain("AI generation enabled");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes config with sources", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/meetsmore/xcli-actions") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "meetsmore/xcli-actions",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, tmpDir } = renderWizard({
      deps,
      gitOrg: "meetsmore",
    });

    await tick();
    stdin.write("\r"); // accept detected repo
    await tick(100);

    const configContent = await Bun.file(
      join(tmpDir, ".xcli", "config.ts"),
    ).text();
    expect(configContent).toContain('repo: "meetsmore/xcli-actions"');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes config with AI disabled", async () => {
    const deps = makeDeps({
      bunWhich: () => null,
    });

    const { stdin, tmpDir } = renderWizard({
      deps,
      gitOrg: undefined,
    });

    await tick();
    stdin.write("\x1b[B"); // down to "No, just use local"
    await tick();
    stdin.write("\r");
    await tick(100);

    const configContent = await Bun.file(
      join(tmpDir, ".xcli", "config.ts"),
    ).text();
    expect(configContent).toContain("ai: { enabled: false }");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates actions dir and sample action", async () => {
    const deps = makeDeps({ bunWhich: () => null });

    const { stdin, tmpDir } = renderWizard({
      deps,
      gitOrg: undefined,
    });

    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(100);

    const helloPath = join(tmpDir, ".xcli", "actions", "hello.sh");
    expect(existsSync(helloPath)).toBe(true);
    const content = await Bun.file(helloPath).text();
    expect(content).toContain("Hello from xcli!");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("no git remote: asks if user has shared repo", async () => {
    const deps = makeDeps({ bunWhich: () => null });

    const { getOutput, unmount, tmpDir } = renderWizard({
      deps,
      gitOrg: undefined,
    });

    await tick();
    const output = getOutput();
    expect(output).toContain("Do you have a shared xcli actions repo?");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("offers to create repo when owner has none", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "Not Found" }),
      bunWhich: () => null,
    });

    const { getOutput, unmount, tmpDir } = renderWizard({
      deps,
      gitOrg: "meetsmore",
    });

    await tick();
    const output = getOutput();
    expect(output).toContain('No shared actions repo found for "meetsmore"');
    expect(output).toContain("Create meetsmore/xcli-actions on GitHub");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("uses detected default branch (master)", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/meetsmore/xcli-actions") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "meetsmore/xcli-actions",
              default_branch: "master",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, getResult, tmpDir } = renderWizard({
      deps,
      gitOrg: "meetsmore",
    });

    await tick();
    stdin.write("\r"); // accept detected repo
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.sources).toEqual([
      { repo: "meetsmore/xcli-actions", ref: "master" },
    ]);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("omits ref when default branch is main", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/meetsmore/xcli-actions") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "meetsmore/xcli-actions",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, getResult, tmpDir } = renderWizard({
      deps,
      gitOrg: "meetsmore",
    });

    await tick();
    stdin.write("\r");
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.sources).toEqual([{ repo: "meetsmore/xcli-actions" }]);
    expect(result?.sources[0]?.ref).toBeUndefined();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes config with all defaults commented out", async () => {
    const deps = makeDeps({ bunWhich: () => "/usr/local/bin/claude" });

    const { stdin, tmpDir } = renderWizard({
      deps,
      gitOrg: undefined,
    });

    await tick();
    stdin.write("\x1b[B"); // down to "No, just use local"
    await tick();
    stdin.write("\r");
    await tick(100);

    const configContent = await Bun.file(
      join(tmpDir, ".xcli", "config.ts"),
    ).text();
    expect(configContent).toContain("// sources: []");
    expect(configContent).toContain("// ai: { enabled: true }");
    expect(configContent).toContain('// actionsDir: "actions"');
    expect(configContent).toContain("// env: {}");
    expect(configContent).toContain("// hooks: {");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("custom repo input: validates and accepts valid repo", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/meetsmore/xcli-actions") {
          return { exitCode: 1, stdout: "", stderr: "Not Found" };
        }
        if (endpoint === "repos/myorg/custom-actions") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "myorg/custom-actions",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, getOutput, getResult, tmpDir } = renderWizard({
      deps,
      gitOrg: "meetsmore",
    });

    await tick();
    // Select "I have a different repo"
    stdin.write("\x1b[B"); // down
    await tick();
    stdin.write("\r");
    await tick();

    const output = getOutput();
    expect(output).toContain("Repo (org/name)");

    // Type the repo name
    for (const ch of "myorg/custom-actions") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.sources).toEqual([{ repo: "myorg/custom-actions" }]);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("custom repo input: shows error for invalid repo", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "Not Found" }),
      bunWhich: () => null,
    });

    const { stdin, getOutput, unmount, tmpDir } = renderWizard({
      deps,
      gitOrg: undefined,
    });

    await tick();
    // Select "Yes, let me enter it"
    stdin.write("\r");
    await tick();

    for (const ch of "bad/repo") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    const output = getOutput();
    expect(output).toContain('Could not find "bad/repo" on GitHub');

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("custom repo input: esc goes back to source selection", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "Not Found" }),
      bunWhich: () => null,
    });

    const { stdin, getOutput, unmount, tmpDir } = renderWizard({
      deps,
      gitOrg: "meetsmore",
    });

    await tick();
    // Select "I have a different repo"
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();

    let output = getOutput();
    expect(output).toContain("Repo (org/name)");

    // Esc back
    stdin.write("\x1b");
    await tick();

    output = getOutput();
    expect(output).toContain("What would you like to do?");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("create-failed: shows error and offers fallback options", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "Not Found" }),
      ghRepoCreate: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "HTTP 403: permission denied",
      }),
      bunWhich: () => null,
    });

    const { stdin, getOutput, unmount, tmpDir } = renderWizard({
      deps,
      gitOrg: "meetsmore",
    });

    await tick();
    // Select "Create meetsmore/xcli-actions on GitHub"
    stdin.write("\r");
    await tick(100);

    const output = getOutput();
    expect(output).toContain("insufficient permissions");
    expect(output).toContain("I have a different repo");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("create-failed: selecting no-source continues", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "Not Found" }),
      ghRepoCreate: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "network error",
      }),
      bunWhich: () => null,
    });

    const { stdin, getResult, tmpDir } = renderWizard({
      deps,
      gitOrg: "meetsmore",
    });

    await tick();
    // Select "Create meetsmore/xcli-actions on GitHub"
    stdin.write("\r");
    await tick(100);

    // Select "No shared repo"
    stdin.write("\x1b[B"); // down to second option
    await tick();
    stdin.write("\r");
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.sources).toEqual([]);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("done screen shows summary", async () => {
    const deps = makeDeps({
      bunWhich: () => "/usr/local/bin/claude",
    });

    const { stdin, getOutput, tmpDir } = renderWizard({
      deps,
      gitOrg: undefined,
    });

    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(100);

    const output = getOutput();
    expect(output).toContain("AI generation enabled");
    expect(output).toContain("Writing .xcli/config.ts");
    expect(output).toContain("Done! Run xcli again to get started");

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
