import { afterEach, describe, expect, test } from "bun:test";
import { extractMetadata } from "../src/core/metadata.ts";
import { type CLISession, fixturePath, Keys, spawnCLI } from "./harness";

describe("metadata parsing", () => {
  let cli: CLISession;

  afterEach(() => {
    cli?.kill();
  });

  test("displays name from # comment frontmatter", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("Hello World");
  });

  test("displays name from // comment frontmatter in .ts files", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    // Navigate into the database category using search
    await cli.waitForText("database");
    cli.type("/database");
    cli.press(Keys.ENTER);
    await cli.waitForText("Reset Database");
  });

  test("displays emoji from frontmatter", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("👋");
  });

  test("displays description from frontmatter", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    await cli.waitForText("A simple hello world script");
  });

  test("infers name from filename when no metadata present", async () => {
    cli = spawnCLI({ cwd: fixturePath("basic-repo") });
    // cleanup.py has no xcli: frontmatter, name should be inferred from filename
    await cli.waitForText("Cleanup");
  });

  test("ignores frontmatter after line 20", async () => {
    cli = spawnCLI({ cwd: fixturePath("metadata-edge-cases") });
    // late-metadata.sh has xcli:name on line 21 — should be ignored
    // Name should be inferred from filename: "Late Metadata"
    await cli.waitForText("Late Metadata");
  });

  test("frontmatter takes priority over export in .ts files", async () => {
    cli = spawnCLI({ cwd: fixturePath("metadata-edge-cases") });
    // ts-both.ts has frontmatter name "Frontmatter Name" and export name "Export Name"
    await cli.waitForText("Frontmatter Name");
  });

  test("parses boolean confirm field from frontmatter", async () => {
    cli = spawnCLI({ cwd: fixturePath("metadata-edge-cases") });
    await cli.waitForText("Dangerous Action");
  });

  test("displays name inferred from filename with no metadata", async () => {
    cli = spawnCLI({ cwd: fixturePath("metadata-edge-cases") });
    // no-metadata.sh has no xcli: comments — name inferred as "No Metadata"
    await cli.waitForText("No Metadata");
  });

  test("parses boolean interactive field from frontmatter", async () => {
    const meta = await extractMetadata(
      fixturePath("metadata-edge-cases/.xcli/actions/interactive-action.sh"),
    );
    expect(meta.interactive).toBe(true);
  });

  test("interactive defaults to false when not specified", async () => {
    const meta = await extractMetadata(
      fixturePath("metadata-edge-cases/.xcli/actions/no-metadata.sh"),
    );
    expect(meta.interactive).toBe(false);
  });
});
