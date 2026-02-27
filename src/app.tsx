import { ConfirmInput } from "@inkjs/ui";
import { Box, Text, useApp } from "ink";
import { Breadcrumbs } from "./components/Breadcrumbs.tsx";
import { FullscreenProvider } from "./components/FullscreenProvider.tsx";
import { InkActionRenderer } from "./components/InkActionRenderer.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { useActions } from "./hooks/useActions.ts";
import { useKeyboard } from "./hooks/useKeyboard.ts";
import { useNavigation } from "./hooks/useNavigation.ts";
import { useSearch } from "./hooks/useSearch.ts";
import type { Action, MenuItem, PluginSyncStatus } from "./types.ts";

function MenuList({
  items,
  selectedIndex,
  pluginSyncStatuses,
}: {
  items: MenuItem[];
  selectedIndex: number;
  pluginSyncStatuses?: Map<string, PluginSyncStatus>;
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
              {item.type === "category" ? (item.isPlugin ? "📦 " : "📁 ") : ""}
              {item.type === "action" && item.emoji ? `${item.emoji} ` : ""}
              {item.label}
              {item.type === "category" ? " ▸" : ""}
            </Text>
            {item.type === "category" &&
              item.isPlugin &&
              pluginSyncStatuses?.get(item.value) === "syncing" && (
                <Text dimColor> ⟳</Text>
              )}
            {item.description && <Text dimColor> ({item.description})</Text>}
          </Box>
        );
      })}
    </>
  );
}

interface AppProps {
  kadaiDir: string;
  /** Called when an action is selected to run with inherited stdio */
  onRunAction: (action: Action) => void;
}

export function App({ kadaiDir, onRunAction }: AppProps) {
  const { exit } = useApp();

  const handleRunAction = (action: Action) => {
    onRunAction(action);
    exit();
  };

  const search = useSearch();
  const nav = useNavigation({ onExit: exit, onNavigate: search.resetSearch });
  const { actions, actionsRef, config, loading, pluginSyncStatuses } =
    useActions({
      kadaiDir,
    });

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
    getMenuItems: buildMenuItems,
    computeFiltered: search.computeFiltered,
    isActive: nav.currentScreen.type === "menu",
    onRunInteractive: handleRunAction,
  });

  if (loading) {
    return <Text dimColor>Loading actions...</Text>;
  }

  if (nav.currentScreen.type === "menu") {
    const menuPath = nav.currentScreen.path;
    const menuItems = buildMenuItems(actions, menuPath);
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
            pluginSyncStatuses={pluginSyncStatuses}
          />
        )}
        <StatusBar />
      </Box>
    );
  }

  if (nav.currentScreen.type === "confirm") {
    const { actionId } = nav.currentScreen;
    const action = actions.find((a) => a.id === actionId);
    if (!action) return <Text color="red">Action not found</Text>;

    const handleConfirm = () => {
      if (action.runtime === "ink") {
        nav.setStack((s) => {
          const next = [
            ...s.slice(0, -1),
            { type: "ink-component" as const, actionId },
          ];
          nav.stackRef.current = next;
          return next;
        });
        return;
      }
      handleRunAction(action);
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

  if (nav.currentScreen.type === "ink-component") {
    const { actionId } = nav.currentScreen;
    const action = actions.find((a) => a.id === actionId);
    if (!action) return <Text color="red">Action not found</Text>;

    return (
      <FullscreenProvider enabled={action.meta.fullscreen ?? false}>
        <InkActionRenderer
          action={action}
          cwd={process.cwd()}
          env={config.env ?? {}}
          onExit={() => nav.popScreen()}
        />
      </FullscreenProvider>
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

  // Build the set of plugin category names
  const pluginCategories = new Set<string>();
  for (const action of actions) {
    if (action.origin.type === "plugin" && action.category.length > 0) {
      pluginCategories.add(action.category[0] as string);
    }
  }

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
            isPlugin: pluginCategories.has(topCategory),
          });
        }
      } else {
        items.push({
          type: "action",
          label: action.meta.name,
          emoji: action.meta.emoji,
          description: action.meta.description,
          value: action.id,
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
    // Sort order: plugin categories → local categories → actions
    if (a.type !== b.type) return a.type === "category" ? -1 : 1;
    if (a.type === "category" && b.type === "category") {
      const aPlugin = a.isPlugin ?? false;
      const bPlugin = b.isPlugin ?? false;
      if (aPlugin !== bPlugin) return aPlugin ? -1 : 1;
      // Within plugins, "~" (user-global) sorts first
      if (aPlugin && bPlugin) {
        if (a.value === "~") return -1;
        if (b.value === "~") return 1;
      }
    }
    return a.label.localeCompare(b.label);
  });

  return items;
}
