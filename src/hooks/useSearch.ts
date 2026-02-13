import fuzzysort from "fuzzysort";
import type { MenuItem } from "../types.ts";
import { useRefState } from "./useRefState.ts";

export function useSearch() {
  const [searchActive, searchActiveRef, setSearchActive] = useRefState(false);
  const [searchQuery, searchQueryRef, setSearchQuery] = useRefState("");
  const [selectedIndex, selectedIndexRef, setSelectedIndex] = useRefState(0);

  const resetSearch = () => {
    setSearchActive(false);
    setSearchQuery("");
    setSelectedIndex(0);
  };

  const computeFiltered = (allItems: MenuItem[], query: string): MenuItem[] => {
    if (!query) return allItems;
    // Remove separators and de-duplicate (new section + main list both have the item)
    const seen = new Set<string>();
    const searchable = allItems.filter((item) => {
      if (item.type === "separator") return false;
      if (seen.has(item.value)) return false;
      seen.add(item.value);
      return true;
    });
    const results = fuzzysort.go(query, searchable, { key: "label" });
    return results.map((r) => r.obj);
  };

  return {
    searchActive,
    searchQuery,
    selectedIndex,
    searchActiveRef,
    searchQueryRef,
    selectedIndexRef,
    setSearchActive,
    setSearchQuery,
    setSelectedIndex,
    resetSearch,
    computeFiltered,
  };
}
