import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shareToSource } from "../../src/ai/share.ts";
import type { Action } from "../../src/types.ts";

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: "test-action",
    meta: { name: "Test Action" },
    filePath: "/tmp/test-action.sh",
    category: [],
    runtime: "bash",
    ...overrides,
  };
}

describe("shareToSource", () => {
  let tempDir: string;
  let fakeRepoDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcli-share-test-"));
    fakeRepoDir = join(tempDir, "fake-source");
    await mkdir(fakeRepoDir, { recursive: true });
    await Bun.$`git -C ${fakeRepoDir} init`.quiet();
    await Bun.$`git -C ${fakeRepoDir} config user.email "test@test.com"`.quiet();
    await Bun.$`git -C ${fakeRepoDir} config user.name "Test"`.quiet();
    await Bun.write(join(fakeRepoDir, "README.md"), "# Test");
    await Bun.$`git -C ${fakeRepoDir} add .`.quiet();
    await Bun.$`git -C ${fakeRepoDir} commit -m "init"`.quiet();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("copies action files to the specified target path", async () => {
    const actionFile = join(tempDir, "deploy.sh");
    await Bun.write(actionFile, "#!/bin/bash\necho deploy");

    const action = makeAction({
      id: "deploy",
      meta: { name: "Deploy" },
      filePath: actionFile,
    });

    const result = await shareToSource({
      actions: [action],
      sourceRepoPath: fakeRepoDir,
      targetPath: "actions/@myorg/alice",
    });

    expect(result.status).toBe("success");

    const files = await Bun.$`git -C ${fakeRepoDir} ls-files`.quiet().text();
    expect(files).toContain("actions/@myorg/alice/deploy.sh");
  });

  test("commits directly on current branch", async () => {
    const actionFile = join(tempDir, "deploy.sh");
    await Bun.write(actionFile, "#!/bin/bash\necho deploy");

    const action = makeAction({
      id: "deploy",
      meta: { name: "Deploy" },
      filePath: actionFile,
    });

    const result = await shareToSource({
      actions: [action],
      sourceRepoPath: fakeRepoDir,
      targetPath: "actions/@myorg/alice",
    });

    expect(result.status).toBe("success");

    const branch = await Bun.$`git -C ${fakeRepoDir} branch --show-current`
      .quiet()
      .text();
    expect(branch.trim()).toMatch(/^(main|master)$/);
  });

  test("commits with descriptive message", async () => {
    const actionFile = join(tempDir, "staging.sh");
    await Bun.write(actionFile, "#!/bin/bash\necho staging");

    const action = makeAction({
      id: "deploy/staging",
      meta: { name: "Deploy to Staging" },
      filePath: actionFile,
    });

    const result = await shareToSource({
      actions: [action],
      sourceRepoPath: fakeRepoDir,
      targetPath: "actions/@myorg/bob",
    });

    expect(result.status).toBe("success");

    const log = await Bun.$`git -C ${fakeRepoDir} log --oneline`.quiet().text();
    expect(log).toContain("Deploy to Staging");
  });

  test("places files at plain actions/ path", async () => {
    const actionFile = join(tempDir, "hello.sh");
    await Bun.write(actionFile, "#!/bin/bash\necho hello");

    const action = makeAction({
      id: "hello",
      meta: { name: "Hello" },
      filePath: actionFile,
    });

    const result = await shareToSource({
      actions: [action],
      sourceRepoPath: fakeRepoDir,
      targetPath: "actions",
    });

    expect(result.status).toBe("success");

    const files = await Bun.$`git -C ${fakeRepoDir} ls-files`.quiet().text();
    expect(files).toContain("actions/hello.sh");
  });

  test("handles invalid source repo gracefully", async () => {
    const actionFile = join(tempDir, "hello.sh");
    await Bun.write(actionFile, "#!/bin/bash\necho hello");

    const action = makeAction({
      filePath: actionFile,
    });

    const result = await shareToSource({
      actions: [action],
      sourceRepoPath: "/nonexistent/path",
      targetPath: "actions",
    });

    expect(result.status).toBe("error");
    expect(result.error).toBeDefined();
  });
});
