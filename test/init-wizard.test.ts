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
  fetchGitHubUsername,
  fetchOrgMembers,
  fetchOrgs,
  fetchRepoCollaborators,
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

describe("fetchOrgs", () => {
  test("returns org list", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "user/orgs") {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ login: "acme" }, { login: "widgets" }]),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
    });

    const orgs = await fetchOrgs(deps);
    expect(orgs).toEqual([{ login: "acme" }, { login: "widgets" }]);
  });

  test("returns empty on failure", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
    });

    const orgs = await fetchOrgs(deps);
    expect(orgs).toEqual([]);
  });
});

describe("fetchGitHubUsername", () => {
  test("returns username", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "user") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ login: "alice" }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
    });

    const username = await fetchGitHubUsername(deps);
    expect(username).toBe("alice");
  });

  test("returns null on failure", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
    });

    const username = await fetchGitHubUsername(deps);
    expect(username).toBeNull();
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

  test("includes share config with branch strategy", () => {
    const config = generateConfigFile({
      sources: [{ repo: "org/repo" }],
      aiEnabled: true,
      share: { strategy: "branch" },
    });
    expect(config).toContain('share: { strategy: "branch" }');
  });

  test("includes share config with PR strategy and reviewer", () => {
    const config = generateConfigFile({
      sources: [{ repo: "org/repo" }],
      aiEnabled: true,
      share: { strategy: "pr", reviewer: "alice" },
    });
    expect(config).toContain('strategy: "pr"');
    expect(config).toContain('reviewer: "alice"');
  });

  test("omits share config for push strategy (default)", () => {
    const config = generateConfigFile({
      sources: [{ repo: "org/repo" }],
      aiEnabled: true,
      share: { strategy: "push" },
    });
    expect(config).not.toContain("share:");
  });

  test("includes org but not userName", () => {
    const config = generateConfigFile({
      sources: [],
      aiEnabled: true,
      org: "myorg",
    });
    expect(config).toContain('org: "myorg"');
    expect(config).not.toContain("userName");
  });

  test("includes autoNavigate", () => {
    const config = generateConfigFile({
      sources: [{ repo: "myorg/xcli-actions" }],
      aiEnabled: true,
      autoNavigate: ["@myorg", "xcli-actions"],
    });
    expect(config).toContain('autoNavigate: ["@myorg", "xcli-actions"]');
  });
});

// ─── writeInitFiles ──────────────────────────────────────────────

describe("writeInitFiles", () => {
  test("creates actions dir, sample action, and config", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xcli-write-test-"));
    try {
      const result = await writeInitFiles(tmpDir, {
        sources: [],
        aiEnabled: false,
      });
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

      const result = await writeInitFiles(tmpDir, {
        sources: [],
        aiEnabled: false,
      });
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
      await writeInitFiles(tmpDir, {
        sources: [{ repo: "meetsmore/xcli-actions" }],
        aiEnabled: true,
      });
      const configContent = await Bun.file(
        join(tmpDir, ".xcli", "config.ts"),
      ).text();
      expect(configContent).toContain('repo: "meetsmore/xcli-actions"');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("writes config with share strategy", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "xcli-write-test-"));
    try {
      await writeInitFiles(tmpDir, {
        sources: [{ repo: "org/repo" }],
        aiEnabled: true,
        share: { strategy: "pr", reviewer: "bob" },
        org: "org",
      });
      const configContent = await Bun.file(
        join(tmpDir, ".xcli", "config.ts"),
      ).text();
      expect(configContent).toContain('strategy: "pr"');
      expect(configContent).toContain('reviewer: "bob"');
      expect(configContent).toContain('org: "org"');
      expect(configContent).not.toContain("userName");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── InitWizard component (orchestration) ────────────────────────

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function renderWizard(opts: { deps: InitDeps }) {
  const tmpDir = mkdtempSync(join(tmpdir(), "xcli-wizard-test-"));
  let doneResult: InitResult | null = null;

  const instance = render(
    React.createElement(InitWizard, {
      cwd: tmpDir,
      deps: opts.deps,
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
  test("shows location question initially", () => {
    const deps = makeDeps();
    const { getOutput, unmount, tmpDir } = renderWizard({ deps });

    const output = getOutput();
    expect(output).toContain("No .xcli directory found");
    expect(output).toContain("Where should xcli actions live?");
    expect(output).toContain("Local only");
    expect(output).toContain("Shared repo");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("local-only flow: location → push strategy → AI → done", async () => {
    const deps = makeDeps({
      bunWhich: () => null,
    });

    const { stdin, getOutput, getResult, tmpDir } = renderWizard({ deps });

    await tick();

    // Phase 1: Select "Local only"
    stdin.write("\r");
    await tick();

    // Phase 3: Push strategy
    let output = getOutput();
    expect(output).toContain("How should changes be pushed?");

    // Select "Push directly to the default branch"
    stdin.write("\r");
    await tick();

    // Phase 5: AI
    output = getOutput();
    expect(output).toContain("Enable AI action generation?");

    // Select "No"
    stdin.write("\x1b[B"); // down to "No"
    await tick();
    stdin.write("\r");
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.sources).toEqual([]);
    expect(result?.aiEnabled).toBe(false);
    expect(existsSync(join(tmpDir, ".xcli", "config.ts"))).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("shared repo flow: location → setup → enter repo → push strategy → AI → done", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
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
      bunWhich: () => "/usr/local/bin/claude",
    });

    const { stdin, getOutput, getResult, tmpDir } = renderWizard({ deps });

    await tick();

    // Phase 1: Select "Shared repo"
    stdin.write("\x1b[B"); // down to "Shared repo"
    await tick();
    stdin.write("\r");
    await tick();

    // Phase 2: Select "Use an existing repo"
    let output = getOutput();
    expect(output).toContain("Shared repo setup");
    stdin.write("\x1b[B"); // down to "Use an existing repo"
    await tick();
    stdin.write("\r");
    await tick();

    // Phase 2b: Enter repo
    output = getOutput();
    expect(output).toContain("Repo (org/name)");
    for (const ch of "myorg/custom-actions") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    // Phase 3: Push strategy
    output = getOutput();
    expect(output).toContain("How should changes be pushed?");
    stdin.write("\r"); // Push directly
    await tick();

    // Phase 5: AI
    output = getOutput();
    expect(output).toContain("Enable AI action generation?");
    stdin.write("\r"); // Yes
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.sources).toEqual([{ repo: "myorg/custom-actions" }]);
    expect(result?.aiEnabled).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("PR strategy flow asks for reviewer", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/org/repo") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "org/repo",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, getOutput, getResult, tmpDir } = renderWizard({ deps });

    await tick();

    // Location → Shared repo
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();

    // Setup → Existing repo
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();

    // Enter repo
    for (const ch of "org/repo") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    // Push strategy → PR (third option)
    stdin.write("\x1b[B"); // down to "branch"
    await tick();
    stdin.write("\x1b[B"); // down to "PR"
    await tick();
    stdin.write("\r");
    await tick();

    // Reviewer
    let output = getOutput();
    expect(output).toContain("Who should review PRs?");
    for (const ch of "alice") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick();

    // AI → No
    output = getOutput();
    expect(output).toContain("Enable AI action generation?");
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();

    // Check config was written with PR strategy and reviewer
    const configContent = await Bun.file(
      join(tmpDir, ".xcli", "config.ts"),
    ).text();
    expect(configContent).toContain('strategy: "pr"');
    expect(configContent).toContain('reviewer: "alice"');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("branch strategy writes config correctly", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/org/repo") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "org/repo",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, tmpDir } = renderWizard({ deps });

    await tick();

    // Location → Shared repo → Existing → enter repo
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    for (const ch of "org/repo") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    // Push strategy → branch (second option)
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();

    // AI → No
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(100);

    const configContent = await Bun.file(
      join(tmpDir, ".xcli", "config.ts"),
    ).text();
    expect(configContent).toContain('share: { strategy: "branch" }');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("enables AI when user selects yes", async () => {
    const deps = makeDeps({
      bunWhich: () => "/usr/local/bin/claude",
    });

    const { stdin, getOutput, getResult, tmpDir } = renderWizard({ deps });

    await tick();

    // Local only
    stdin.write("\r");
    await tick();

    // Push directly
    stdin.write("\r");
    await tick();

    // AI → Yes
    stdin.write("\r");
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.aiEnabled).toBe(true);

    const doneOutput = getOutput();
    expect(doneOutput).toContain("AI generation enabled");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("disables AI when user selects no", async () => {
    const deps = makeDeps({ bunWhich: () => null });

    const { stdin, getOutput, getResult, tmpDir } = renderWizard({ deps });

    await tick();

    // Local only
    stdin.write("\r");
    await tick();

    // Push directly
    stdin.write("\r");
    await tick();

    // AI → No
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

  test("custom repo input: shows error for invalid repo", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "Not Found" }),
      bunWhich: () => null,
    });

    const { stdin, getOutput, unmount, tmpDir } = renderWizard({ deps });

    await tick();

    // Shared repo → Existing
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\x1b[B");
    await tick();
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

  test("custom repo input: esc goes back to repo setup", async () => {
    const deps = makeDeps({ bunWhich: () => null });

    const { stdin, getOutput, unmount, tmpDir } = renderWizard({ deps });

    await tick();

    // Shared repo → Existing
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
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
    expect(output).toContain("Shared repo setup");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates actions dir and sample action", async () => {
    const deps = makeDeps({ bunWhich: () => null });

    const { stdin, tmpDir } = renderWizard({ deps });

    await tick();

    // Local → push → AI no
    stdin.write("\r");
    await tick();
    stdin.write("\r");
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

  test("done screen shows summary", async () => {
    const deps = makeDeps({
      bunWhich: () => "/usr/local/bin/claude",
    });

    const { stdin, getOutput, tmpDir } = renderWizard({ deps });

    await tick();

    // Local → push → AI yes
    stdin.write("\r");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\r");
    await tick(100);

    const output = getOutput();
    expect(output).toContain("AI generation enabled");
    expect(output).toContain("Writing .xcli/config.ts");
    expect(output).toContain("Done! Run xcli again to get started");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes config with org but not userName from existing repo", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/myorg/shared") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "myorg/shared",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, tmpDir } = renderWizard({ deps });

    await tick();

    // Shared repo → Existing → enter repo
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    for (const ch of "myorg/shared") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    // Push directly → AI No
    stdin.write("\r");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(100);

    const configContent = await Bun.file(
      join(tmpDir, ".xcli", "config.ts"),
    ).text();
    expect(configContent).toContain('org: "myorg"');
    expect(configContent).not.toContain("userName");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("create repo flow: fetches orgs and creates repo", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "user/orgs") {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ login: "acme" }]),
            stderr: "",
          };
        }
        if (endpoint === "user") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ login: "alice" }),
            stderr: "",
          };
        }
        if (endpoint === "repos/alice/xcli-actions") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "alice/xcli-actions",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      ghRepoCreate: async () => ({
        exitCode: 0,
        stdout: "https://github.com/alice/xcli-actions",
        stderr: "",
      }),
      bunWhich: () => null,
    });

    const { stdin, getOutput, getResult, tmpDir } = renderWizard({ deps });

    await tick();

    // Shared repo
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();

    // Create new repo
    stdin.write("\r");
    await tick(100);

    // Choose org: should show Personal (alice) and acme
    let output = getOutput();
    expect(output).toContain("Where should the repo be created?");
    expect(output).toContain("Personal (alice/xcli-actions)");
    expect(output).toContain("acme");

    // Select Personal
    stdin.write("\r");
    await tick(100);

    // Push strategy
    output = getOutput();
    expect(output).toContain("How should changes be pushed?");
    stdin.write("\r");
    await tick();

    // AI → No
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(100);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.sources).toEqual([{ repo: "alice/xcli-actions" }]);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("create repo failure: shows error and fallback options", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "user/orgs") {
          return { exitCode: 0, stdout: "[]", stderr: "" };
        }
        if (endpoint === "user") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ login: "alice" }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      ghRepoCreate: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "HTTP 403: permission denied",
      }),
      bunWhich: () => null,
    });

    const { stdin, getOutput, unmount, tmpDir } = renderWizard({ deps });

    await tick();

    // Shared repo → Create new
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\r"); // Create new
    await tick(100);

    // Select Personal
    stdin.write("\r");
    await tick(100);

    const output = getOutput();
    expect(output).toContain("insufficient permissions");
    expect(output).toContain("I have a different repo");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reviewer input: esc goes back to push strategy", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/org/repo") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "org/repo",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, getOutput, unmount, tmpDir } = renderWizard({ deps });

    await tick();

    // Shared → Existing → enter repo
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    for (const ch of "org/repo") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    // Push strategy → PR
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();

    let output = getOutput();
    expect(output).toContain("Who should review PRs?");

    // Esc back
    stdin.write("\x1b");
    await tick();

    output = getOutput();
    expect(output).toContain("How should changes be pushed?");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reviewer can be left blank", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/org/repo") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "org/repo",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, getOutput, tmpDir } = renderWizard({ deps });

    await tick();

    // Shared → Existing → enter repo
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    for (const ch of "org/repo") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    // Push strategy → PR
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();

    // Reviewer: leave blank, just press enter
    stdin.write("\r");
    await tick();

    // Should move to AI step
    const output = getOutput();
    expect(output).toContain("Enable AI action generation?");

    // AI → No → done
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(100);

    const configContent = await Bun.file(
      join(tmpDir, ".xcli", "config.ts"),
    ).text();
    expect(configContent).toContain('strategy: "pr"');
    expect(configContent).not.toContain("reviewer:");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("vim j/k navigation works in arrow phases", async () => {
    const deps = makeDeps({ bunWhich: () => null });

    const { stdin, getOutput, unmount, tmpDir } = renderWizard({ deps });

    await tick();

    // Phase 1: Use j to move down to "Shared repo"
    stdin.write("j");
    await tick();

    let output = getOutput();
    // "Shared repo" should be highlighted (selected)
    expect(output).toContain("❯ Shared repo");

    // Use k to move back up to "Local only"
    stdin.write("k");
    await tick();

    output = getOutput();
    expect(output).toContain("❯ Local only");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("vim j/k navigation works in create-failed phase", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "user/orgs") {
          return { exitCode: 0, stdout: "[]", stderr: "" };
        }
        if (endpoint === "user") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ login: "alice" }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      ghRepoCreate: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "HTTP 403: permission denied",
      }),
      bunWhich: () => null,
    });

    const { stdin, getOutput, unmount, tmpDir } = renderWizard({ deps });

    await tick();

    // Navigate to create-failed: Shared repo → Create new → select personal → fails
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\r"); // Create new
    await tick(100);
    stdin.write("\r"); // Select Personal
    await tick(100);

    let output = getOutput();
    expect(output).toContain("I have a different repo");

    // Use j to move down
    stdin.write("j");
    await tick();

    output = getOutput();
    expect(output).toContain("❯ No shared repo");

    // Use k to move back up
    stdin.write("k");
    await tick();

    output = getOutput();
    expect(output).toContain("❯ I have a different repo");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("PR strategy: shows searchable reviewer list when members found", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/org/repo") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "org/repo",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        if (endpoint === "repos/org/repo/collaborators") {
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              { login: "alice" },
              { login: "bob" },
              { login: "charlie" },
            ]),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, getOutput, tmpDir } = renderWizard({ deps });

    await tick();

    // Navigate: Shared → Existing → enter repo → PR strategy
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    for (const ch of "org/repo") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    // Push strategy → PR
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(200);

    // Should show searchable reviewer list
    let output = getOutput();
    expect(output).toContain("Who should review PRs?");
    expect(output).toContain("No reviewer (skip)");
    expect(output).toContain("alice");
    expect(output).toContain("bob");
    expect(output).toContain("charlie");

    // Type to filter — "bo" should narrow to bob
    stdin.write("b");
    await tick();
    stdin.write("o");
    await tick();

    output = getOutput();
    expect(output).toContain("bob");
    expect(output).not.toContain("charlie");

    // Select bob (navigate down past "No reviewer" to bob)
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();

    // Should move to AI step
    output = getOutput();
    expect(output).toContain("Enable AI action generation?");

    // AI → No → done
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(100);

    const configContent = await Bun.file(
      join(tmpDir, ".xcli", "config.ts"),
    ).text();
    expect(configContent).toContain('strategy: "pr"');
    expect(configContent).toContain('reviewer: "bob"');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("PR strategy: falls back to text input when no members found", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/org/repo") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "org/repo",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        // Collaborators and org members both fail
        if (endpoint === "repos/org/repo/collaborators") {
          return { exitCode: 1, stdout: "", stderr: "Not Found" };
        }
        if (endpoint === "orgs/org/members") {
          return { exitCode: 1, stdout: "", stderr: "Not Found" };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, getOutput, tmpDir } = renderWizard({ deps });

    await tick();

    // Navigate: Shared → Existing → enter repo → PR strategy
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    for (const ch of "org/repo") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    // Push strategy → PR
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(200);

    // Should fall back to text input
    const output = getOutput();
    expect(output).toContain("Who should review PRs?");
    // Should have the text input cursor, not a list
    expect(output).toContain(">");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("PR strategy: skip reviewer in searchable list", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/org/repo") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "org/repo",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        if (endpoint === "repos/org/repo/collaborators") {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ login: "alice" }]),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, getOutput, tmpDir } = renderWizard({ deps });

    await tick();

    // Navigate: Shared → Existing → enter repo → PR strategy
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    for (const ch of "org/repo") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    // Push strategy → PR
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(200);

    // "No reviewer (skip)" should be first and selected
    let output = getOutput();
    expect(output).toContain("No reviewer (skip)");

    // Press enter to select "No reviewer (skip)"
    stdin.write("\r");
    await tick();

    // Should move to AI step
    output = getOutput();
    expect(output).toContain("Enable AI action generation?");

    // Finish: AI → No
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(100);

    const configContent = await Bun.file(
      join(tmpDir, ".xcli", "config.ts"),
    ).text();
    expect(configContent).toContain('strategy: "pr"');
    expect(configContent).not.toContain("reviewer:");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("PR strategy: falls back to org members when collaborators fail", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/org/repo") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              full_name: "org/repo",
              default_branch: "main",
            }),
            stderr: "",
          };
        }
        if (endpoint === "repos/org/repo/collaborators") {
          return { exitCode: 1, stdout: "", stderr: "Not Found" };
        }
        if (endpoint === "orgs/org/members") {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ login: "dave" }, { login: "eve" }]),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
      bunWhich: () => null,
    });

    const { stdin, getOutput, unmount, tmpDir } = renderWizard({ deps });

    await tick();

    // Navigate: Shared → Existing → enter repo → PR strategy
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    for (const ch of "org/repo") {
      stdin.write(ch);
    }
    await tick();
    stdin.write("\r");
    await tick(100);

    // Push strategy → PR
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick(200);

    // Should show org members as fallback
    const output = getOutput();
    expect(output).toContain("dave");
    expect(output).toContain("eve");

    unmount();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ─── fetchRepoCollaborators ──────────────────────────────────────

describe("fetchRepoCollaborators", () => {
  test("returns collaborator list", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "repos/org/repo/collaborators") {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ login: "alice" }, { login: "bob" }]),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
    });

    const members = await fetchRepoCollaborators("org/repo", deps);
    expect(members).toEqual([{ login: "alice" }, { login: "bob" }]);
  });

  test("returns empty on failure", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "Not Found" }),
    });

    const members = await fetchRepoCollaborators("org/repo", deps);
    expect(members).toEqual([]);
  });

  test("returns empty on invalid JSON", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 0, stdout: "not json", stderr: "" }),
    });

    const members = await fetchRepoCollaborators("org/repo", deps);
    expect(members).toEqual([]);
  });
});

// ─── fetchOrgMembers ─────────────────────────────────────────────

describe("fetchOrgMembers", () => {
  test("returns member list", async () => {
    const deps = makeDeps({
      ghApi: async (endpoint: string) => {
        if (endpoint === "orgs/myorg/members") {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ login: "carol" }, { login: "dave" }]),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      },
    });

    const members = await fetchOrgMembers("myorg", deps);
    expect(members).toEqual([{ login: "carol" }, { login: "dave" }]);
  });

  test("returns empty on failure", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
    });

    const members = await fetchOrgMembers("myorg", deps);
    expect(members).toEqual([]);
  });

  test("returns empty on invalid JSON", async () => {
    const deps = makeDeps({
      ghApi: async () => ({ exitCode: 0, stdout: "bad", stderr: "" }),
    });

    const members = await fetchOrgMembers("myorg", deps);
    expect(members).toEqual([]);
  });
});
