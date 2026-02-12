import fuzzysort from "fuzzysort";
import { useRef, useState } from "react";
import type { MenuItem } from "../types.ts";

export function useSearch() {
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const searchActiveRef = useRef(false);
  const searchQueryRef = useRef("");
  const selectedIndexRef = useRef(0);

  const resetSearch = () => {
    searchActiveRef.current = false;
    searchQueryRef.current = "";
    selectedIndexRef.current = 0;
    setSearchActive(false);
    setSearchQuery("");
    setSelectedIndex(0);
  };

  const computeFiltered = (allItems: MenuItem[], query: string): MenuItem[] => {
    if (!query) return allItems;
    const results = fuzzysort.go(query, allItems, { key: "label" });
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
