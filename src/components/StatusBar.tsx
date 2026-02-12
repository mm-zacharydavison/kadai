import { Box, Text } from "ink";

interface StatusBarProps {
  syncing?: boolean;
}

export function StatusBar({ syncing }: StatusBarProps) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor>{"↑↓/j/k navigate  / search  esc back  q quit"}</Text>
      {syncing && <Text dimColor>{"⟳ Syncing sources..."}</Text>}
    </Box>
  );
}
