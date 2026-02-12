import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSystemPrompt } from "../../src/ai/prompt.ts";

describe("buildSystemPrompt", () => {
  let actionsDir: string;

  beforeEach(async () => {
    actionsDir = await mkdtemp(join(tmpdir(), "xcli-prompt-test-"));
  });

  afterEach(async () => {
    await rm(actionsDir, { recursive: true, force: true });
  });

  test("includes xcli metadata format docs", async () => {
    const prompt = await buildSystemPrompt(actionsDir, actionsDir);
    expect(prompt).toContain("xcli:name");
    expect(prompt).toContain("xcli:emoji");
  });

  test("includes supported extensions", async () => {
    const prompt = await buildSystemPrompt(actionsDir, actionsDir);
    expect(prompt).toContain(".sh");
    expect(prompt).toContain(".ts");
    expect(prompt).toContain(".py");
  });

  test("lists existing actions", async () => {
    await writeFile(join(actionsDir, "hello.sh"), "#!/bin/bash\necho hi");
    await mkdir(join(actionsDir, "db"), { recursive: true });
    await writeFile(join(actionsDir, "db", "reset.ts"), "console.log('reset')");

    const prompt = await buildSystemPrompt(actionsDir, actionsDir);
    expect(prompt).toContain("hello.sh");
    expect(prompt).toContain("db/reset.ts");
  });

  test("handles empty actions directory", async () => {
    const prompt = await buildSystemPrompt(actionsDir, actionsDir);
    expect(prompt.toLowerCase()).toContain("no existing actions");
  });

  test("includes the absolute actions dir path", async () => {
    const prompt = await buildSystemPrompt(actionsDir, actionsDir);
    expect(prompt).toContain(actionsDir);
  });
});
