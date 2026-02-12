import { useInput } from "ink";
import type { Action, MenuItem, Screen } from "../types.ts";

interface UseKeyboardOptions {
  stackRef: React.MutableRefObject<Screen[]>;
  actionsRef: React.MutableRefObject<Action[]>;
  searchActiveRef: React.MutableRefObject<boolean>;
  searchQueryRef: React.MutableRefObject<string>;
  selectedIndexRef: React.MutableRefObject<number>;
  setSearchActive: (active: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSelectedIndex: (index: number) => void;
  setStack: React.Dispatch<React.SetStateAction<Screen[]>>;
  resetSearch: () => void;
  pushScreen: (screen: Screen) => void;
  popScreen: () => void;
  exit: () => void;
  getMenuItems: (actions: Action[], path: string[]) => MenuItem[];
  computeFiltered: (items: MenuItem[], query: string) => MenuItem[];
}

export function useKeyboard({
  stackRef,
  actionsRef,
  searchActiveRef,
  searchQueryRef,
  selectedIndexRef,
  setSearchActive,
  setSearchQuery,
  setSelectedIndex,
  setStack,
  resetSearch,
  pushScreen,
  popScreen,
  exit,
  getMenuItems,
  computeFiltered,
}: UseKeyboardOptions) {
  useInput((input, key) => {
    const screen = stackRef.current.at(-1) as Screen;

    // Output screen: only ESC to go back
    if (screen.type === "output") {
      if (key.escape) popScreen();
      return;
    }

    // Confirm screen: ENTER to confirm, ESC to cancel
    if (screen.type === "confirm") {
      if (key.return) {
        const actionId = screen.actionId;
        setStack((s) => {
          const next = [
            ...s.slice(0, -1),
            { type: "output" as const, actionId },
          ];
          stackRef.current = next;
          return next;
        });
      }
      if (key.escape) popScreen();
      return;
    }

    // Menu screen — search mode
    if (searchActiveRef.current) {
      if (key.escape) {
        resetSearch();
        return;
      }
      if (key.return) {
        selectCurrentItem(
          screen,
          actionsRef,
          searchQueryRef,
          selectedIndexRef,
          getMenuItems,
          computeFiltered,
          pushScreen,
        );
        return;
      }
      if (key.backspace || key.delete) {
        const newQuery = searchQueryRef.current.slice(0, -1);
        searchQueryRef.current = newQuery;
        selectedIndexRef.current = 0;
        setSearchQuery(newQuery);
        setSelectedIndex(0);
        return;
      }
      if (key.upArrow) {
        const newIdx = Math.max(0, selectedIndexRef.current - 1);
        selectedIndexRef.current = newIdx;
        setSelectedIndex(newIdx);
        return;
      }
      if (key.downArrow) {
        const allItems = getMenuItems(actionsRef.current, screen.path);
        const filtered = computeFiltered(allItems, searchQueryRef.current);
        const newIdx = Math.min(
          filtered.length - 1,
          selectedIndexRef.current + 1,
        );
        selectedIndexRef.current = newIdx;
        setSelectedIndex(newIdx);
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        const newQuery = searchQueryRef.current + input;
        searchQueryRef.current = newQuery;
        selectedIndexRef.current = 0;
        setSearchQuery(newQuery);
        setSelectedIndex(0);
      }
      return;
    }

    // Menu screen — normal mode
    if (input === "/") {
      searchActiveRef.current = true;
      searchQueryRef.current = "";
      selectedIndexRef.current = 0;
      setSearchActive(true);
      setSearchQuery("");
      setSelectedIndex(0);
      return;
    }
    if (input === "q") {
      exit();
      return;
    }
    if (key.escape) {
      popScreen();
      return;
    }
    if (key.return) {
      selectCurrentItem(
        screen,
        actionsRef,
        searchQueryRef,
        selectedIndexRef,
        getMenuItems,
        computeFiltered,
        pushScreen,
      );
      return;
    }
    if (key.upArrow || input === "k") {
      const newIdx = Math.max(0, selectedIndexRef.current - 1);
      selectedIndexRef.current = newIdx;
      setSelectedIndex(newIdx);
      return;
    }
    if (key.downArrow || input === "j") {
      const allItems = getMenuItems(actionsRef.current, screen.path);
      const newIdx = Math.min(
        allItems.length - 1,
        selectedIndexRef.current + 1,
      );
      selectedIndexRef.current = newIdx;
      setSelectedIndex(newIdx);
      return;
    }
  });
}

function selectCurrentItem(
  screen: Screen & { type: "menu" },
  actionsRef: React.MutableRefObject<Action[]>,
  searchQueryRef: React.MutableRefObject<string>,
  selectedIndexRef: React.MutableRefObject<number>,
  getMenuItems: (actions: Action[], path: string[]) => MenuItem[],
  computeFiltered: (items: MenuItem[], query: string) => MenuItem[],
  pushScreen: (screen: Screen) => void,
) {
  const menuPath = screen.path;
  const allItems = getMenuItems(actionsRef.current, menuPath);
  const filtered = computeFiltered(allItems, searchQueryRef.current);
  const item = filtered[selectedIndexRef.current];
  if (!item) return;

  if (item.type === "category") {
    pushScreen({ type: "menu", path: [...menuPath, item.value] });
  } else {
    const action = actionsRef.current.find((a) => a.id === item.value);
    if (action?.meta.confirm) {
      pushScreen({ type: "confirm", actionId: item.value });
    } else {
      pushScreen({ type: "output", actionId: item.value });
    }
  }
}
