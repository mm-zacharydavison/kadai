import { describe, expect, test } from "bun:test";
import { buildMenuItems } from "../src/app.tsx";
import type { Action } from "../src/types.ts";

function makeAction(
  overrides: Partial<Action> & { id: string; category: string[] },
): Action {
  return {
    filePath: `/fake/${overrides.id}.sh`,
    meta: { name: overrides.id.split("/").pop() ?? overrides.id },
    runtime: "bash",
    origin: { type: "local" },
    ...overrides,
  };
}

const rootAction = makeAction({ id: "hello", category: [] });
const dbReset = makeAction({ id: "database/reset", category: ["database"] });
const dbSeed = makeAction({ id: "database/seed", category: ["database"] });
const deepAction = makeAction({
  id: "infra/aws/deploy",
  category: ["infra", "aws"],
});

const allActions: Action[] = [rootAction, dbReset, dbSeed, deepAction];

describe("buildMenuItems", () => {
  test("root-level actions appear at root", () => {
    const items = buildMenuItems(allActions, []);
    const actionItems = items.filter(
      (i) => i.type === "action" && i.value === "hello",
    );
    expect(actionItems).toHaveLength(1);
  });

  test("categorized actions do NOT appear at root — only their folder", () => {
    const items = buildMenuItems(allActions, []);
    const actionValues = items
      .filter((i) => i.type === "action")
      .map((i) => i.value);
    // Only the root-level action should appear as an action item
    expect(actionValues).toEqual(["hello"]);

    // Category folders should exist for "database" and "infra"
    const categoryLabels = items
      .filter((i) => i.type === "category")
      .map((i) => i.label);
    expect(categoryLabels).toContain("database");
    expect(categoryLabels).toContain("infra");
  });

  test("navigating into a category shows contained actions", () => {
    const items = buildMenuItems(allActions, ["database"]);
    const actionValues = items
      .filter((i) => i.type === "action")
      .map((i) => i.value);
    expect(actionValues).toContain("database/reset");
    expect(actionValues).toContain("database/seed");
    expect(actionValues).toHaveLength(2);
  });

  test("deeply nested categories show as subcategory folders", () => {
    const items = buildMenuItems(allActions, ["infra"]);
    // Should show "aws" as a category folder, not the action itself
    const categoryLabels = items
      .filter((i) => i.type === "category")
      .map((i) => i.label);
    expect(categoryLabels).toContain("aws");
    // No action items at this level
    const actionItems = items.filter((i) => i.type === "action");
    expect(actionItems).toHaveLength(0);
  });

  test("navigating into a deeply nested category shows actions", () => {
    const items = buildMenuItems(allActions, ["infra", "aws"]);
    const actionValues = items
      .filter((i) => i.type === "action")
      .map((i) => i.value);
    expect(actionValues).toEqual(["infra/aws/deploy"]);
  });

  test("categories are sorted before actions", () => {
    const items = buildMenuItems(allActions, []);
    const types = items.map((i) => i.type);
    const firstActionIndex = types.indexOf("action");
    const lastCategoryIndex = types.lastIndexOf("category");
    expect(lastCategoryIndex).toBeLessThan(firstActionIndex);
  });
});

describe("buildMenuItems — plugin support", () => {
  const pluginAction = makeAction({
    id: "@zdavison/claude-tools/hello",
    category: ["@zdavison/claude-tools"],
    origin: { type: "plugin", pluginName: "@zdavison/claude-tools" },
  });

  const pluginNestedAction = makeAction({
    id: "@zdavison/claude-tools/deploy/staging",
    category: ["@zdavison/claude-tools", "deploy"],
    origin: { type: "plugin", pluginName: "@zdavison/claude-tools" },
  });

  const localAction = makeAction({
    id: "hello",
    category: [],
    origin: { type: "local" },
  });

  const localCategoryAction = makeAction({
    id: "database/reset",
    category: ["database"],
    origin: { type: "local" },
  });

  const userGlobalAction = makeAction({
    id: "~/my-script",
    category: ["~"],
    origin: { type: "plugin", pluginName: "~" },
  });

  const allPluginActions = [
    pluginAction,
    pluginNestedAction,
    localAction,
    localCategoryAction,
    userGlobalAction,
  ];

  test("plugin categories have isPlugin flag", () => {
    const items = buildMenuItems(allPluginActions, []);
    const pluginCat = items.find(
      (i) => i.type === "category" && i.value === "@zdavison/claude-tools",
    );
    expect(pluginCat).toBeDefined();
    expect(pluginCat?.isPlugin).toBe(true);
  });

  test("local categories do NOT have isPlugin flag", () => {
    const items = buildMenuItems(allPluginActions, []);
    const localCat = items.find(
      (i) => i.type === "category" && i.value === "database",
    );
    expect(localCat).toBeDefined();
    expect(localCat?.isPlugin).toBeFalsy();
  });

  test("sort order: user-global → plugins → local categories → local actions", () => {
    const items = buildMenuItems(allPluginActions, []);
    const labels = items.map((i) => i.value);

    const tildeIdx = labels.indexOf("~");
    const pluginIdx = labels.indexOf("@zdavison/claude-tools");
    const dbIdx = labels.indexOf("database");
    const helloIdx = labels.indexOf("hello");

    // User-global first, then plugins, then local categories, then actions
    expect(tildeIdx).toBeLessThan(pluginIdx);
    expect(pluginIdx).toBeLessThan(dbIdx);
    expect(dbIdx).toBeLessThan(helloIdx);
  });

  test("navigating into plugin category shows plugin actions", () => {
    const items = buildMenuItems(allPluginActions, ["@zdavison/claude-tools"]);
    const actionValues = items
      .filter((i) => i.type === "action")
      .map((i) => i.value);
    expect(actionValues).toContain("@zdavison/claude-tools/hello");

    // Should also show "deploy" as a subcategory
    const categoryLabels = items
      .filter((i) => i.type === "category")
      .map((i) => i.label);
    expect(categoryLabels).toContain("deploy");
  });
});
