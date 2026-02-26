import { useInput } from "ink";
import type { Action, MenuItem, Screen } from "../types.ts";

function nextSelectableIndex(
  items: MenuItem[],
  current: number,
  direction: 1 | -1,
): number {
  let next = current + direction;
  while (
    next >= 0 &&
    next < items.length &&
    items[next]?.type === "separator"
  ) {
    next += direction;
  }
  if (next < 0 || next >= items.length) return current;
  return next;
}

interface UseKeyboardOptions {
  stackRef: React.MutableRefObject<Screen[]>;
  actionsRef: React.MutableRefObject<Action[]>;
  searchActiveRef: React.MutableRefObject<boolean>;
  searchQueryRef: React.MutableRefObject<string>;
  selectedIndexRef: React.MutableRefObject<number>;
  setSearchActive: (active: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSelectedIndex: (index: number) => void;
  resetSearch: () => void;
  pushScreen: (screen: Screen) => void;
  popScreen: () => void;
  exit: () => void;
  getMenuItems: (actions: Action[], path: string[]) => MenuItem[];
  computeFiltered: (items: MenuItem[], query: string) => MenuItem[];
  isActive?: boolean;
  onRunInteractive?: (action: Action) => void;
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
  resetSearch,
  pushScreen,
  popScreen,
  exit,
  getMenuItems,
  computeFiltered,
  isActive = true,
  onRunInteractive,
}: UseKeyboardOptions) {
  useInput(
    (input, key) => {
      const screen = stackRef.current.at(-1) as Screen;

      // Output screen: ESC or Enter to go back
      if (screen.type === "output") {
        if (key.escape || key.return) popScreen();
        return;
      }

      // From here, screen must be "menu"
      if (screen.type !== "menu") return;

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
            onRunInteractive,
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
          const allItems = getMenuItems(actionsRef.current, screen.path);
          const filtered = computeFiltered(allItems, searchQueryRef.current);
          const newIdx = nextSelectableIndex(
            filtered,
            selectedIndexRef.current,
            -1,
          );
          selectedIndexRef.current = newIdx;
          setSelectedIndex(newIdx);
          return;
        }
        if (key.downArrow) {
          const allItems = getMenuItems(actionsRef.current, screen.path);
          const filtered = computeFiltered(allItems, searchQueryRef.current);
          const newIdx = nextSelectableIndex(
            filtered,
            selectedIndexRef.current,
            1,
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
        const allItems = getMenuItems(actionsRef.current, screen.path);
        const newIdx = nextSelectableIndex(
          allItems,
          selectedIndexRef.current,
          -1,
        );
        selectedIndexRef.current = newIdx;
        setSelectedIndex(newIdx);
        return;
      }
      if (key.downArrow || input === "j") {
        const allItems = getMenuItems(actionsRef.current, screen.path);
        const newIdx = nextSelectableIndex(
          allItems,
          selectedIndexRef.current,
          1,
        );
        selectedIndexRef.current = newIdx;
        setSelectedIndex(newIdx);
        return;
      }
    },
    { isActive },
  );
}

function selectCurrentItem(
  screen: Screen & { type: "menu" },
  actionsRef: React.MutableRefObject<Action[]>,
  searchQueryRef: React.MutableRefObject<string>,
  selectedIndexRef: React.MutableRefObject<number>,
  getMenuItems: (actions: Action[], path: string[]) => MenuItem[],
  computeFiltered: (items: MenuItem[], query: string) => MenuItem[],
  pushScreen: (screen: Screen) => void,
  onRunInteractive?: (action: Action) => void,
) {
  const menuPath = screen.path;
  const allItems = getMenuItems(actionsRef.current, menuPath);
  const filtered = computeFiltered(allItems, searchQueryRef.current);
  const item = filtered[selectedIndexRef.current];
  if (!item || item.type === "separator") return;

  if (item.type === "category") {
    pushScreen({ type: "menu", path: [...menuPath, item.value] });
  } else {
    const action = actionsRef.current.find((a) => a.id === item.value);
    if (action?.meta.confirm) {
      pushScreen({ type: "confirm", actionId: item.value });
    } else if (action?.meta.interactive && onRunInteractive) {
      onRunInteractive(action);
    } else {
      pushScreen({ type: "output", actionId: item.value });
    }
  }
}
