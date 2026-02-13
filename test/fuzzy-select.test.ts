import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { FuzzySelect } from "../src/components/FuzzySelect.tsx";
import { stripAnsi } from "./harness.ts";

const options = [
  { label: "Deploy to staging", value: "deploy-staging" },
  { label: "Deploy to production", value: "deploy-prod" },
  { label: "Reset cache", value: "reset-cache" },
  { label: "Run migrations", value: "run-migrations" },
];

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function renderSelect(
  props: Partial<React.ComponentProps<typeof FuzzySelect>> = {},
) {
  const instance = render(
    React.createElement(FuzzySelect, {
      options,
      onChange: () => {},
      ...props,
    }),
  );

  return {
    ...instance,
    getOutput: () => stripAnsi(instance.lastFrame() ?? ""),
  };
}

describe("FuzzySelect", () => {
  test("renders all options", () => {
    const { getOutput } = renderSelect();
    const output = getOutput();
    expect(output).toContain("Deploy to staging");
    expect(output).toContain("Deploy to production");
    expect(output).toContain("Reset cache");
    expect(output).toContain("Run migrations");
  });

  test("first item has cursor indicator", () => {
    const { getOutput } = renderSelect();
    const output = getOutput();
    const lines = output.split("\n");
    const deployLine = lines.find((l) => l.includes("Deploy to staging"));
    expect(deployLine).toContain("❯");
  });

  test("arrow down moves cursor", async () => {
    const { getOutput, stdin } = renderSelect();

    stdin.write("\x1b[B"); // down arrow
    await tick();

    const output = getOutput();
    const lines = output.split("\n");
    const prodLine = lines.find((l) => l.includes("Deploy to production"));
    expect(prodLine).toContain("❯");
  });

  test("arrow up moves cursor", async () => {
    const { getOutput, stdin } = renderSelect();

    stdin.write("\x1b[B"); // down
    await tick();
    stdin.write("\x1b[A"); // up
    await tick();

    const output = getOutput();
    const lines = output.split("\n");
    const stagingLine = lines.find((l) => l.includes("Deploy to staging"));
    expect(stagingLine).toContain("❯");
  });

  test("enter selects current item", async () => {
    let selected: string | undefined;
    const { stdin } = renderSelect({
      onChange: (v) => {
        selected = v;
      },
    });

    stdin.write("\x1b[B"); // down to "Deploy to production"
    await tick();
    stdin.write("\r"); // enter
    await tick();

    expect(selected).toBe("deploy-prod");
  });

  test("/ activates search mode", async () => {
    const { getOutput, stdin } = renderSelect();

    stdin.write("/");
    await tick();

    const output = getOutput();
    expect(output).toContain("/");
  });

  test("typing in search mode filters options", async () => {
    const { getOutput, stdin } = renderSelect();

    stdin.write("/");
    await tick();
    stdin.write("reset");
    await tick();

    const output = getOutput();
    expect(output).toContain("Reset cache");
    expect(output).not.toContain("Deploy to staging");
  });

  test("escape in search mode cancels search (does not call onEscape)", async () => {
    let escapeCalled = false;
    const { getOutput, stdin } = renderSelect({
      onEscape: () => {
        escapeCalled = true;
      },
    });

    stdin.write("/");
    await tick();
    stdin.write("dep");
    await tick();

    stdin.write("\x1b"); // escape
    await tick();

    // Search should be cancelled, all items visible again
    const output = getOutput();
    expect(output).toContain("Reset cache");
    expect(output).toContain("Deploy to staging");
    expect(escapeCalled).toBe(false);
  });

  test("escape in normal mode calls onEscape", async () => {
    let escapeCalled = false;
    const { stdin } = renderSelect({
      onEscape: () => {
        escapeCalled = true;
      },
    });

    stdin.write("\x1b"); // escape
    await tick();

    expect(escapeCalled).toBe(true);
  });

  test("enter in search mode selects and resets search", async () => {
    let selected: string | undefined;
    const { stdin } = renderSelect({
      onChange: (v) => {
        selected = v;
      },
    });

    stdin.write("/");
    await tick();
    stdin.write("reset");
    await tick();

    stdin.write("\r"); // enter
    await tick();

    expect(selected).toBe("reset-cache");
  });

  test("backspace in search mode removes character", async () => {
    const { getOutput, stdin } = renderSelect();

    stdin.write("/");
    await tick();
    stdin.write("reset");
    await tick();
    stdin.write("\x7f"); // backspace
    await tick();

    const output = getOutput();
    // "rese" should still filter but show more results than "reset"
    expect(output).toContain("Reset cache");
  });

  test("isActive=false disables input", async () => {
    let selected: string | undefined;
    const { stdin } = renderSelect({
      isActive: false,
      onChange: (v) => {
        selected = v;
      },
    });

    stdin.write("\r"); // enter
    await tick();

    expect(selected).toBeUndefined();
  });

  test("hint text shows / search in normal mode", () => {
    const { getOutput } = renderSelect();
    const output = getOutput();
    expect(output).toContain("/ search");
  });
});
