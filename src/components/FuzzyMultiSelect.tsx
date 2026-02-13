import { Box, Text, useInput } from "ink";
import { useRef } from "react";
import { useFuzzyList } from "../hooks/useFuzzyList.ts";
import { useRefState } from "../hooks/useRefState.ts";

interface FuzzyMultiSelectProps {
  options: { label: string; value: string }[];
  onSubmit: (values: string[]) => void;
  onEscape?: () => void;
  isActive?: boolean;
}

export function FuzzyMultiSelect({
  options,
  onSubmit,
  onEscape,
  isActive = true,
}: FuzzyMultiSelectProps) {
  const [selected, , setSelected] = useRefState<Set<string>>(new Set());
  const selectedRef = useRef<Set<string>>(new Set());

  const {
    searchActive,
    searchActiveRef,
    searchQuery,
    selectedIndex,
    filteredItems,
    activateSearch,
    deactivateSearch,
    appendChar,
    deleteChar,
    moveUp,
    moveDown,
    resetSearch,
  } = useFuzzyList(options);

  const toggleCurrent = () => {
    const item = filteredItems[selectedIndex];
    if (!item) return;
    const next = new Set(selectedRef.current);
    if (next.has(item.value)) {
      next.delete(item.value);
    } else {
      next.add(item.value);
    }
    selectedRef.current = next;
    setSelected(next);
  };

  useInput(
    (input, key) => {
      if (searchActiveRef.current) {
        if (key.escape) {
          deactivateSearch();
          return;
        }
        if (key.upArrow) {
          moveUp();
          return;
        }
        if (key.downArrow) {
          moveDown();
          return;
        }
        if (input === " ") {
          toggleCurrent();
          return;
        }
        if (key.return) {
          resetSearch();
          const values = options
            .filter((o) => selectedRef.current.has(o.value))
            .map((o) => o.value);
          onSubmit(values);
          return;
        }
        if (key.backspace || key.delete) {
          deleteChar();
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          appendChar(input);
        }
        return;
      }

      // Normal mode
      if (key.escape) {
        onEscape?.();
        return;
      }
      if (input === "/") {
        activateSearch();
        return;
      }
      if (key.upArrow) {
        moveUp();
        return;
      }
      if (key.downArrow) {
        moveDown();
        return;
      }
      if (input === " ") {
        toggleCurrent();
        return;
      }
      if (key.return) {
        const values = options
          .filter((o) => selectedRef.current.has(o.value))
          .map((o) => o.value);
        onSubmit(values);
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column">
      {searchActive && (
        <Box>
          <Text color="cyan">
            / {searchQuery}
            <Text inverse> </Text>
          </Text>
        </Box>
      )}
      {filteredItems.map((item, i) => {
        const isCurrent = i === selectedIndex;
        const isChecked = selected.has(item.value);
        return (
          <Box key={item.value}>
            <Text color={isCurrent ? "cyan" : undefined}>
              {isCurrent ? "❯ " : "  "}
              {isChecked ? "[x] " : "[ ] "}
              {item.label}
            </Text>
          </Box>
        );
      })}
      {!searchActive && (
        <Box marginTop={1}>
          <Text dimColor>space toggle enter confirm / search</Text>
        </Box>
      )}
    </Box>
  );
}
