import { ConfirmInput } from "@inkjs/ui";
import { Box, Text, useApp } from "ink";
import { useState } from "react";
import { ActionOutput } from "./components/ActionOutput.tsx";
import { Breadcrumbs } from "./components/Breadcrumbs.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ShareScreen } from "./components/share-screen/ShareScreen.tsx";
import { useActions } from "./hooks/useActions.ts";
import { useKeyboard } from "./hooks/useKeyboard.ts";
import { useNavigation } from "./hooks/useNavigation.ts";
import { useSearch } from "./hooks/useSearch.ts";
import type { Action, GenerationResult, MenuItem } from "./types.ts";

function MenuList({
  items,
  selectedIndex,
}: {
  items: MenuItem[];
  selectedIndex: number;
}) {
  const hasAnyNew = items.some((item) => item.isNew);

  return (
    <>
      {items.map((item, i) => {
        if (item.type === "separator") {
          return (
            <Box key={`sep-${item.value}`} marginTop={i > 0 ? 1 : 0}>
              <Text dimColor bold>
                {item.label}
              </Text>
            </Box>
          );
        }
        const selected = i === selectedIndex;
        return (
          <Box key={`${i}-${item.value}`}>
            <Text color={selected ? "cyan" : undefined}>
              {selected ? "❯ " : "  "}
            </Text>
            {hasAnyNew && <Text>{item.isNew ? "✨ " : "   "}</Text>}
            <Text color={selected ? "cyan" : undefined}>
              {item.type === "category" ? "📁 " : ""}
              {item.type === "action" && item.emoji ? `${item.emoji} ` : ""}
              {item.label}
              {item.type === "category" ? " ▸" : ""}
            </Text>
            {item.description && <Text dimColor> ({item.description})</Text>}
            {item.source && <Text dimColor>{` ${item.source}`}</Text>}
          </Box>
        );
      })}
    </>
  );
}

interface AppProps {
  cwd: string;
  xcliDir: string;
  onRequestHandover?: () => void;
  generationResult?: GenerationResult;
}

export function App({
  cwd,
  xcliDir,
  onRequestHandover,
  generationResult,
}: AppProps) {
  const { exit } = useApp();
  const [showShareScreen, setShowShareScreen] = useState(
    () => (generationResult?.newActions.length ?? 0) > 0,
  );

  const search = useSearch();
  const nav = useNavigation({ onExit: exit, onNavigate: search.resetSearch });
  const { actions, actionsRef, config, loading, syncing } = useActions({
    xcliDir,
    setStack: nav.setStack,
    stackRef: nav.stackRef,
  });

  const getMenuItems = (actionsList: Action[], path: string[]): MenuItem[] => {
    return buildMenuItems(actionsList, path);
  };

  const aiEnabled = config.ai?.enabled !== false;
  const hasSources = (config.sources?.length ?? 0) > 0;

  useKeyboard({
    stackRef: nav.stackRef,
    actionsRef,
    searchActiveRef: search.searchActiveRef,
    searchQueryRef: search.searchQueryRef,
    selectedIndexRef: search.selectedIndexRef,
    setSearchActive: search.setSearchActive,
    setSearchQuery: search.setSearchQuery,
    setSelectedIndex: search.setSelectedIndex,
    resetSearch: search.resetSearch,
    pushScreen: nav.pushScreen,
    popScreen: nav.popScreen,
    exit,
    getMenuItems,
    computeFiltered: search.computeFiltered,
    onRequestHandover,
    aiEnabled,
    hasSources,
    isActive:
      !showShareScreen &&
      nav.currentScreen.type !== "share" &&
      nav.currentScreen.type !== "confirm",
  });

  if (loading) {
    return <Text dimColor>Loading actions...</Text>;
  }

  // Share screen from AI generation result
  if (showShareScreen && generationResult) {
    return (
      <ShareScreen
        newActions={generationResult.newActions}
        sources={config.sources ?? []}
        cwd={cwd}
        config={config}
        xcliDir={xcliDir}
        onDone={() => setShowShareScreen(false)}
      />
    );
  }

  // Share screen from menu 's' keybinding
  if (nav.currentScreen.type === "share") {
    const shareActions = nav.currentScreen.actionIds
      .map((id) => actions.find((a) => a.id === id))
      .filter((a): a is Action => a !== undefined);

    if (shareActions.length === 0) {
      nav.popScreen();
      return null;
    }

    return (
      <ShareScreen
        newActions={shareActions}
        sources={config.sources ?? []}
        cwd={cwd}
        config={config}
        xcliDir={xcliDir}
        onDone={() => nav.popScreen()}
      />
    );
  }

  if (nav.currentScreen.type === "menu") {
    const menuPath = nav.currentScreen.path;
    const menuItems = getMenuItems(actions, menuPath);
    const filteredItems = search.computeFiltered(menuItems, search.searchQuery);

    // Skip past leading separator if selectedIndex lands on one
    if (
      filteredItems[search.selectedIndex]?.type === "separator" &&
      search.selectedIndex === 0 &&
      filteredItems.length > 1
    ) {
      search.setSelectedIndex(1);
      search.selectedIndexRef.current = 1;
    }

    return (
      <Box flexDirection="column">
        <Breadcrumbs path={menuPath} />
        {search.searchActive && (
          <Box marginBottom={1}>
            <Text>/ {search.searchQuery}</Text>
            <Text dimColor>█</Text>
          </Box>
        )}
        {filteredItems.length === 0 && menuItems.length === 0 ? (
          <Text dimColor>No actions found</Text>
        ) : filteredItems.length === 0 ? (
          <Text dimColor>No matching items</Text>
        ) : (
          <MenuList
            items={filteredItems}
            selectedIndex={search.selectedIndex}
          />
        )}
        <StatusBar
          syncing={syncing}
          aiEnabled={aiEnabled}
          hasSources={hasSources}
        />
      </Box>
    );
  }

  if (nav.currentScreen.type === "confirm") {
    const { actionId } = nav.currentScreen;
    const action = actions.find((a) => a.id === actionId);
    if (!action) return <Text color="red">Action not found</Text>;

    const handleConfirm = () => {
      nav.setStack((s) => {
        const next = [...s.slice(0, -1), { type: "output" as const, actionId }];
        nav.stackRef.current = next;
        return next;
      });
    };

    return (
      <Box flexDirection="column">
        <Box>
          <Text>
            Run <Text bold>{action.meta.name}</Text>?{" "}
          </Text>
          <ConfirmInput
            onConfirm={handleConfirm}
            onCancel={() => nav.popScreen()}
          />
        </Box>
      </Box>
    );
  }

  if (nav.currentScreen.type === "output") {
    const { actionId } = nav.currentScreen;
    const action = actions.find((a) => a.id === actionId);
    if (!action) return <Text color="red">Action not found</Text>;

    return (
      <Box flexDirection="column">
        <ActionOutput action={action} cwd={cwd} config={config} />
        <Box marginTop={1}>
          <Text dimColor>Press enter or esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return null;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isRecentlyAdded(action: Action): boolean {
  if (!action.addedAt) return false;
  return Date.now() - action.addedAt < SEVEN_DAYS_MS;
}

export function buildMenuItems(actions: Action[], path: string[]): MenuItem[] {
  const categories = new Set<string>();
  const items: MenuItem[] = [];
  const newActionIds = new Set<string>();

  // Build a set of recently-added action IDs for this menu level
  for (const action of actions) {
    if (isRecentlyAdded(action)) {
      newActionIds.add(action.id);
    }
  }

  if (path.length === 0) {
    // Root level: show category folders and root-level actions only
    for (const action of actions) {
      if (action.category.length > 0) {
        const topCategory = action.category[0] as string;
        if (!categories.has(topCategory)) {
          categories.add(topCategory);
          items.push({
            type: "category",
            label: topCategory,
            value: topCategory,
          });
        }
      } else {
        items.push({
          type: "action",
          label: action.meta.name,
          emoji: action.meta.emoji,
          description: action.meta.description,
          value: action.id,
          source:
            action.source?.type !== "local" ? action.source?.label : undefined,
          isNew: newActionIds.has(action.id),
        });
      }
    }
  } else {
    for (const action of actions) {
      const matchesPath = path.every((p, i) => action.category[i] === p);
      if (!matchesPath) continue;

      if (action.category.length === path.length) {
        items.push({
          type: "action",
          label: action.meta.name,
          emoji: action.meta.emoji,
          description: action.meta.description,
          value: action.id,
          source:
            action.source?.type !== "local" ? action.source?.label : undefined,
          isNew: newActionIds.has(action.id),
        });
      } else if (action.category.length > path.length) {
        const subCategory = action.category[path.length] as string;
        if (!categories.has(subCategory)) {
          categories.add(subCategory);
          items.push({
            type: "category",
            label: subCategory,
            value: subCategory,
          });
        }
      }
    }
  }

  items.sort((a, b) => {
    // Categories first
    if (a.type !== b.type) return a.type === "category" ? -1 : 1;
    // Local actions before external
    const aExternal = a.source ? 1 : 0;
    const bExternal = b.source ? 1 : 0;
    if (aExternal !== bExternal) return aExternal - bExternal;
    return a.label.localeCompare(b.label);
  });

  // Prepend "New" section only when there's a mix of new and non-new items
  const newItems = items.filter((item) => item.isNew);
  const hasNonNewItems = items.some(
    (item) => item.type === "action" && !item.isNew,
  );
  if (newItems.length > 0 && hasNonNewItems) {
    const newSection: MenuItem[] = [
      { type: "separator", label: "New", value: "__sep_new" },
      ...newItems,
      { type: "separator", label: "───", value: "__sep_divider" },
    ];
    return [...newSection, ...items];
  }

  return items;
}
