import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { useFuzzyList } from "../src/hooks/useFuzzyList.ts";

const items = [
  { label: "Deploy to staging", value: "deploy-staging" },
  { label: "Deploy to production", value: "deploy-prod" },
  { label: "Reset cache", value: "reset-cache" },
  { label: "Run migrations", value: "run-migrations" },
];

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

type HookResult = ReturnType<typeof useFuzzyList>;

function renderHook(hookItems = items) {
  let result: HookResult;

  function Comp() {
    result = useFuzzyList(hookItems);
    return React.createElement(Text, null, "ok");
  }

  const instance = render(React.createElement(Comp));
  return {
    ...instance,
    get: () => result!,
  };
}

describe("useFuzzyList", () => {
  test("returns all items initially", () => {
    const { get } = renderHook();
    expect(get().filteredItems).toEqual(items);
    expect(get().searchActive).toBe(false);
    expect(get().searchQuery).toBe("");
    expect(get().selectedIndex).toBe(0);
  });

  test("appendChar filters items via fuzzy search", async () => {
    const { get } = renderHook();
    get().activateSearch();
    get().appendChar("d");
    get().appendChar("e");
    get().appendChar("p");
    await tick();

    const filtered = get().filteredItems;
    expect(filtered.length).toBe(2);
    expect(filtered.every((i) => i.label.toLowerCase().includes("dep"))).toBe(
      true,
    );
  });

  test("deleteChar removes last character", async () => {
    const { get } = renderHook();
    get().activateSearch();
    get().appendChar("d");
    get().appendChar("e");
    get().appendChar("p");
    get().deleteChar();
    await tick();

    expect(get().searchQuery).toBe("de");
  });

  test("deleteChar on empty query does nothing", () => {
    const { get } = renderHook();
    get().activateSearch();
    get().deleteChar();
    // ref should still be empty
    expect(get().searchActiveRef.current).toBe(true);
  });

  test("moveDown increments selectedIndex", () => {
    const { get } = renderHook();
    get().moveDown();
    // ref updates synchronously
    expect(get().selectedIndexRef.current).toBe(1);
  });

  test("moveDown clamps at last item", () => {
    const { get } = renderHook();
    get().moveDown();
    get().moveDown();
    get().moveDown();
    get().moveDown();
    get().moveDown(); // past end
    expect(get().selectedIndexRef.current).toBe(3);
  });

  test("moveUp decrements selectedIndex", () => {
    const { get } = renderHook();
    get().moveDown();
    get().moveDown();
    get().moveUp();
    expect(get().selectedIndexRef.current).toBe(1);
  });

  test("moveUp clamps at zero", () => {
    const { get } = renderHook();
    get().moveUp();
    expect(get().selectedIndexRef.current).toBe(0);
  });

  test("activateSearch sets searchActive", () => {
    const { get } = renderHook();
    get().activateSearch();
    expect(get().searchActiveRef.current).toBe(true);
  });

  test("deactivateSearch clears search state", () => {
    const { get } = renderHook();
    get().activateSearch();
    get().appendChar("x");
    get().deactivateSearch();

    expect(get().searchActiveRef.current).toBe(false);
  });

  test("resetSearch clears everything", () => {
    const { get } = renderHook();
    get().activateSearch();
    get().appendChar("d");
    get().moveDown();
    get().resetSearch();

    expect(get().searchActiveRef.current).toBe(false);
    expect(get().selectedIndexRef.current).toBe(0);
  });

  test("selectedIndex clamps when filter reduces list", async () => {
    const { get } = renderHook();
    get().moveDown();
    get().moveDown();
    get().moveDown(); // index = 3

    get().activateSearch();
    get().appendChar("r");
    get().appendChar("e");
    get().appendChar("s");
    get().appendChar("e");
    get().appendChar("t");
    await tick();

    // "Reset cache" matches, list has 1 item — index should clamp to 0
    expect(get().filteredItems.length).toBe(1);
    expect(get().selectedIndex).toBe(0);
  });

  test("empty items returns empty filteredItems", () => {
    const { get } = renderHook([]);
    expect(get().filteredItems).toEqual([]);
  });
});
