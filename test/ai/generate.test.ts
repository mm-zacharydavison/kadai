import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectNewActions, snapshotActions } from "../../src/ai/generate.ts";

describe("snapshotActions", () => {
  let actionsDir: string;

  beforeEach(async () => {
    actionsDir = await mkdtemp(join(tmpdir(), "xcli-gen-test-"));
  });

  afterEach(async () => {
    await rm(actionsDir, { recursive: true, force: true });
  });

  test("captures all files with mtimes", async () => {
    await writeFile(join(actionsDir, "hello.sh"), "#!/bin/bash\necho hi");
    await mkdir(join(actionsDir, "db"), { recursive: true });
    await writeFile(join(actionsDir, "db", "reset.ts"), "console.log('reset')");

    const snapshot = await snapshotActions(actionsDir);
    expect(snapshot.size).toBe(2);
    expect(snapshot.has(join(actionsDir, "hello.sh"))).toBe(true);
    expect(snapshot.has(join(actionsDir, "db", "reset.ts"))).toBe(true);

    // mtimes should be numbers
    for (const mtime of snapshot.values()) {
      expect(typeof mtime).toBe("number");
      expect(mtime).toBeGreaterThan(0);
    }
  });

  test("ignores dotfiles and underscore-prefixed files", async () => {
    await writeFile(join(actionsDir, ".hidden.sh"), "#!/bin/bash");
    await writeFile(join(actionsDir, "_helper.sh"), "#!/bin/bash");
    await writeFile(join(actionsDir, "visible.sh"), "#!/bin/bash");

    const snapshot = await snapshotActions(actionsDir);
    expect(snapshot.size).toBe(1);
    expect(snapshot.has(join(actionsDir, "visible.sh"))).toBe(true);
  });
});

describe("detectNewActions", () => {
  let actionsDir: string;

  beforeEach(async () => {
    actionsDir = await mkdtemp(join(tmpdir(), "xcli-diff-test-"));
  });

  afterEach(async () => {
    await rm(actionsDir, { recursive: true, force: true });
  });

  test("detects new file", async () => {
    await writeFile(join(actionsDir, "old.sh"), "#!/bin/bash\necho old");
    const snapshot = await snapshotActions(actionsDir);

    // Add a new file after snapshot
    await writeFile(
      join(actionsDir, "new.sh"),
      "#!/bin/bash\n# xcli:name New Script\necho new",
    );

    const newActions = await detectNewActions(actionsDir, snapshot);
    expect(newActions.length).toBe(1);
    expect(newActions[0]?.id).toBe("new");
  });

  test("detects modified file", async () => {
    const filePath = join(actionsDir, "edit.sh");
    await writeFile(filePath, "#!/bin/bash\necho v1");

    const snapshot = await snapshotActions(actionsDir);

    // Modify the file — change mtime to future to guarantee detection
    await writeFile(filePath, "#!/bin/bash\necho v2");
    const futureTime = new Date(Date.now() + 10000);
    await utimes(filePath, futureTime, futureTime);

    const newActions = await detectNewActions(actionsDir, snapshot);
    expect(newActions.length).toBe(1);
    expect(newActions[0]?.id).toBe("edit");
  });

  test("returns empty when nothing changed", async () => {
    await writeFile(join(actionsDir, "stable.sh"), "#!/bin/bash\necho stable");
    const snapshot = await snapshotActions(actionsDir);

    const newActions = await detectNewActions(actionsDir, snapshot);
    expect(newActions.length).toBe(0);
  });

  test("detects new files in subdirectories", async () => {
    const snapshot = await snapshotActions(actionsDir);

    await mkdir(join(actionsDir, "deploy"), { recursive: true });
    await writeFile(
      join(actionsDir, "deploy", "staging.sh"),
      "#!/bin/bash\n# xcli:name Deploy Staging\necho deploying",
    );

    const newActions = await detectNewActions(actionsDir, snapshot);
    expect(newActions.length).toBe(1);
    expect(newActions[0]?.id).toBe("deploy/staging");
    expect(newActions[0]?.category).toEqual(["deploy"]);
  });
});
