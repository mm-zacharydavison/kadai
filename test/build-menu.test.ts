import { describe, expect, test } from "bun:test";
import { buildMenuItems } from "../src/app.tsx";
import type { Action } from "../src/types.ts";

function makeAction(overrides: Partial<Action> & { id: string }): Action {
  return {
    meta: { name: overrides.id },
    filePath: `/fake/${overrides.id}.ts`,
    category: [],
    runtime: "bun",
    origin: { type: "local" },
    ...overrides,
  };
}

const NOW = Date.now();
const ONE_DAY = 24 * 60 * 60 * 1000;

describe("buildMenuItems — new action indicators", () => {
  test("no isNew when no actions are recent", () => {
    const actions = [
      makeAction({ id: "old-a", addedAt: NOW - 30 * ONE_DAY }),
      makeAction({ id: "old-b", addedAt: NOW - 14 * ONE_DAY }),
    ];
    const items = buildMenuItems(actions, []);
    expect(items.every((i) => !i.isNew)).toBe(true);
  });

  test("isNew is set when actions are recent", () => {
    const actions = [
      makeAction({ id: "new-a", addedAt: NOW - 1 * ONE_DAY }),
      makeAction({ id: "new-b", addedAt: NOW - 2 * ONE_DAY }),
    ];
    const items = buildMenuItems(actions, []);
    expect(items.every((i) => i.isNew)).toBe(true);
  });

  test("no separators are produced", () => {
    const actions = [
      makeAction({ id: "new-a", addedAt: NOW - 1 * ONE_DAY }),
      makeAction({ id: "old-b", addedAt: NOW - 30 * ONE_DAY }),
    ];
    const items = buildMenuItems(actions, []);
    expect(items.every((i) => i.type !== "separator")).toBe(true);
  });

  test("new actions are not duplicated", () => {
    const actions = [
      makeAction({
        id: "new-a",
        meta: { name: "New Action" },
        addedAt: NOW - 1 * ONE_DAY,
      }),
      makeAction({
        id: "old-b",
        meta: { name: "Old Action" },
        addedAt: NOW - 30 * ONE_DAY,
      }),
    ];
    const items = buildMenuItems(actions, []);
    expect(items.filter((i) => i.value === "new-a").length).toBe(1);
    expect(items.filter((i) => i.value === "old-b").length).toBe(1);
  });

  test("old actions have isNew falsy", () => {
    const actions = [
      makeAction({ id: "new-a", addedAt: NOW - 1 * ONE_DAY }),
      makeAction({ id: "old-b", addedAt: NOW - 30 * ONE_DAY }),
    ];
    const items = buildMenuItems(actions, []);
    const oldItems = items.filter((i) => i.value === "old-b");
    expect(oldItems.every((i) => !i.isNew)).toBe(true);
  });

  test("preserves alphabetical sort order", () => {
    const actions = [
      makeAction({
        id: "charlie",
        meta: { name: "Charlie" },
        addedAt: NOW - 1 * ONE_DAY,
      }),
      makeAction({
        id: "alpha",
        meta: { name: "Alpha" },
        addedAt: NOW - 30 * ONE_DAY,
      }),
      makeAction({
        id: "bravo",
        meta: { name: "Bravo" },
        addedAt: NOW - 2 * ONE_DAY,
      }),
    ];
    const items = buildMenuItems(actions, []);
    expect(items.map((i) => i.label)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  test("isNew works within category views", () => {
    const actions = [
      makeAction({
        id: "db/migrate",
        meta: { name: "Migrate" },
        category: ["db"],
        addedAt: NOW - 1 * ONE_DAY,
      }),
      makeAction({
        id: "db/seed",
        meta: { name: "Seed" },
        category: ["db"],
        addedAt: NOW - 30 * ONE_DAY,
      }),
    ];
    const items = buildMenuItems(actions, ["db"]);
    expect(items.every((i) => i.type !== "separator")).toBe(true);

    const migrateItem = items.find((i) => i.value === "db/migrate");
    const seedItem = items.find((i) => i.value === "db/seed");
    expect(migrateItem?.isNew).toBe(true);
    expect(seedItem?.isNew).toBeFalsy();
  });

  test("actions with no addedAt are not considered new", () => {
    const actions = [makeAction({ id: "no-date" })];
    const items = buildMenuItems(actions, []);
    expect(items.every((i) => !i.isNew)).toBe(true);
  });

  test("actions exactly 7 days old are not new", () => {
    const actions = [
      makeAction({ id: "boundary", addedAt: NOW - 7 * ONE_DAY }),
      makeAction({ id: "old", addedAt: NOW - 30 * ONE_DAY }),
    ];
    const items = buildMenuItems(actions, []);
    expect(items.every((i) => !i.isNew)).toBe(true);
  });
});
