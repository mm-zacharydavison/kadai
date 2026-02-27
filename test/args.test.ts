import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/core/args.ts";

describe("parseArgs", () => {
  test("no args → interactive", () => {
    expect(parseArgs([])).toEqual({ type: "interactive" });
  });

  test("list --json → list", () => {
    expect(parseArgs(["list", "--json"])).toEqual({
      type: "list",
      all: false,
    });
  });

  test("list --json --all → list with all", () => {
    expect(parseArgs(["list", "--json", "--all"])).toEqual({
      type: "list",
      all: true,
    });
  });

  test("list without --json → error", () => {
    const result = parseArgs(["list"]);
    expect(result.type).toBe("error");
  });

  test("run hello → run with actionId", () => {
    expect(parseArgs(["run", "hello"])).toEqual({
      type: "run",
      actionId: "hello",
    });
  });

  test("run database/reset → run with nested actionId", () => {
    expect(parseArgs(["run", "database/reset"])).toEqual({
      type: "run",
      actionId: "database/reset",
    });
  });

  test("run without action id → error", () => {
    const result = parseArgs(["run"]);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toContain("action ID");
    }
  });

  test("mcp → mcp", () => {
    expect(parseArgs(["mcp"])).toEqual({ type: "mcp" });
  });

  test("--version → version", () => {
    expect(parseArgs(["--version"])).toEqual({ type: "version" });
  });

  test("-v → version", () => {
    expect(parseArgs(["-v"])).toEqual({ type: "version" });
  });

  test("unknown command → error", () => {
    const result = parseArgs(["foobar"]);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toContain("foobar");
    }
  });
});
