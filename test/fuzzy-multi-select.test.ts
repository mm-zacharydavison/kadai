import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { FuzzyMultiSelect } from "../src/components/FuzzyMultiSelect.tsx";
import { stripAnsi } from "./harness.ts";

const options = [
  { label: "alice", value: "alice" },
  { label: "bob", value: "bob" },
  { label: "charlie", value: "charlie" },
  { label: "Backend (team)", value: "org/backend" },
];

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function renderMultiSelect(
  props: Partial<React.ComponentProps<typeof FuzzyMultiSelect>> = {},
) {
  const instance = render(
    React.createElement(FuzzyMultiSelect, {
      options,
      onSubmit: () => {},
      ...props,
    }),
  );

  return {
    ...instance,
    getOutput: () => stripAnsi(instance.lastFrame() ?? ""),
  };
}

describe("FuzzyMultiSelect", () => {
  test("renders all options with checkboxes", () => {
    const { getOutput } = renderMultiSelect();
    const output = getOutput();
    expect(output).toContain("alice");
    expect(output).toContain("bob");
    expect(output).toContain("charlie");
    expect(output).toContain("Backend (team)");
  });

  test("space toggles selection", async () => {
    const { getOutput, stdin } = renderMultiSelect();

    stdin.write(" "); // toggle alice
    await tick();

    const output = getOutput();
    const lines = output.split("\n");
    const aliceLine = lines.find((l) => l.includes("alice"));
    expect(aliceLine).toContain("[x]");
  });

  test("space toggles off", async () => {
    const { getOutput, stdin } = renderMultiSelect();

    stdin.write(" "); // toggle on
    await tick();
    stdin.write(" "); // toggle off
    await tick();

    const output = getOutput();
    const lines = output.split("\n");
    const aliceLine = lines.find((l) => l.includes("alice"));
    expect(aliceLine).toContain("[ ]");
  });

  test("enter submits selected values", async () => {
    let submitted: string[] | undefined;
    const { stdin } = renderMultiSelect({
      onSubmit: (v) => {
        submitted = v;
      },
    });

    stdin.write(" "); // toggle alice
    await tick();
    stdin.write("\x1b[B"); // down to bob
    await tick();
    stdin.write(" "); // toggle bob
    await tick();
    stdin.write("\r"); // submit
    await tick();

    expect(submitted).toEqual(["alice", "bob"]);
  });

  test("enter with no selections submits empty array", async () => {
    let submitted: string[] | undefined;
    const { stdin } = renderMultiSelect({
      onSubmit: (v) => {
        submitted = v;
      },
    });

    stdin.write("\r"); // submit with nothing selected
    await tick();

    expect(submitted).toEqual([]);
  });

  test("search filters but preserves selections", async () => {
    let submitted: string[] | undefined;
    const { getOutput, stdin } = renderMultiSelect({
      onSubmit: (v) => {
        submitted = v;
      },
    });

    // Select alice
    stdin.write(" ");
    await tick();

    // Search for "bob"
    stdin.write("/");
    await tick();
    stdin.write("bob");
    await tick();

    const output = getOutput();
    expect(output).toContain("bob");
    expect(output).not.toContain("alice");

    // Select bob from filtered list
    stdin.write(" ");
    await tick();

    // Cancel search to see all items
    stdin.write("\x1b");
    await tick();

    // Submit
    stdin.write("\r");
    await tick();

    // Both alice and bob should be in submitted values
    expect(submitted).toEqual(["alice", "bob"]);
  });

  test("escape in search mode cancels search (does not call onEscape)", async () => {
    let escapeCalled = false;
    const { getOutput, stdin } = renderMultiSelect({
      onEscape: () => {
        escapeCalled = true;
      },
    });

    stdin.write("/");
    await tick();
    stdin.write("ali");
    await tick();

    stdin.write("\x1b");
    await tick();

    const output = getOutput();
    // All items should be visible again
    expect(output).toContain("alice");
    expect(output).toContain("bob");
    expect(escapeCalled).toBe(false);
  });

  test("escape in normal mode calls onEscape", async () => {
    let escapeCalled = false;
    const { stdin } = renderMultiSelect({
      onEscape: () => {
        escapeCalled = true;
      },
    });

    stdin.write("\x1b");
    await tick();

    expect(escapeCalled).toBe(true);
  });

  test("isActive=false disables input", async () => {
    let submitted: string[] | undefined;
    const { stdin } = renderMultiSelect({
      isActive: false,
      onSubmit: (v) => {
        submitted = v;
      },
    });

    stdin.write("\r");
    await tick();

    expect(submitted).toBeUndefined();
  });
});
