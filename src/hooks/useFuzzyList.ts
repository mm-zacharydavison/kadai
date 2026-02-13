import fuzzysort from "fuzzysort";
import { useMemo } from "react";
import { useRefState } from "./useRefState.ts";

interface ListItem {
  label: string;
  value: string;
}

export function useFuzzyList(items: ListItem[]) {
  const [searchActive, searchActiveRef, setSearchActive] = useRefState(false);
  const [searchQuery, searchQueryRef, setSearchQuery] = useRefState("");
  const [selectedIndex, selectedIndexRef, setSelectedIndex] = useRefState(0);

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const results = fuzzysort.go(searchQuery, items, { key: "label" });
    return results.map((r) => r.obj);
  }, [items, searchQuery]);

  // Clamp selectedIndex when filtered list shrinks
  if (selectedIndex >= filteredItems.length && filteredItems.length > 0) {
    setSelectedIndex(filteredItems.length - 1);
  }

  const activateSearch = () => {
    setSearchActive(true);
  };

  const deactivateSearch = () => {
    setSearchActive(false);
    setSearchQuery("");
    setSelectedIndex(0);
  };

  const appendChar = (ch: string) => {
    setSearchQuery(searchQueryRef.current + ch);
    setSelectedIndex(0);
  };

  const deleteChar = () => {
    const q = searchQueryRef.current;
    if (q.length > 0) {
      setSearchQuery(q.slice(0, -1));
      setSelectedIndex(0);
    }
  };

  const moveUp = () => {
    const cur = selectedIndexRef.current;
    if (cur > 0) {
      setSelectedIndex(cur - 1);
    }
  };

  const moveDown = () => {
    const cur = selectedIndexRef.current;
    if (cur < filteredItems.length - 1) {
      setSelectedIndex(cur + 1);
    }
  };

  const resetSearch = () => {
    setSearchActive(false);
    setSearchQuery("");
    setSelectedIndex(0);
  };

  return {
    searchActive,
    searchActiveRef,
    searchQuery,
    selectedIndex,
    selectedIndexRef,
    filteredItems,
    activateSearch,
    deactivateSearch,
    appendChar,
    deleteChar,
    moveUp,
    moveDown,
    resetSearch,
  };
}
