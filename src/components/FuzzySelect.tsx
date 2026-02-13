import { Box, Text, useInput } from "ink";
import { useFuzzyList } from "../hooks/useFuzzyList.ts";

interface FuzzySelectProps {
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  onEscape?: () => void;
  isActive?: boolean;
}

export function FuzzySelect({
  options,
  onChange,
  onEscape,
  isActive = true,
}: FuzzySelectProps) {
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
        if (key.return) {
          const item = filteredItems[selectedIndex];
          if (item) {
            resetSearch();
            onChange(item.value);
          }
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
      if (key.return) {
        const item = filteredItems[selectedIndex];
        if (item) {
          onChange(item.value);
        }
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
        return (
          <Box key={item.value}>
            <Text color={isCurrent ? "cyan" : undefined}>
              {isCurrent ? "❯ " : "  "}
              {item.label}
            </Text>
          </Box>
        );
      })}
      {!searchActive && (
        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate enter select / search</Text>
        </Box>
      )}
    </Box>
  );
}
