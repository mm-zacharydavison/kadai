import { Box, Text } from "ink";

interface StatusBarProps {
  syncing?: boolean;
  aiEnabled?: boolean;
}

export function StatusBar({ syncing, aiEnabled = true }: StatusBarProps) {
  const hints = aiEnabled
    ? "↑↓/j/k navigate  / search  n new (🤖)  esc back  q quit"
    : "↑↓/j/k navigate  / search  esc back  q quit";

  return (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor>{hints}</Text>
      {syncing && <Text dimColor>{"⟳ Syncing sources..."}</Text>}
    </Box>
  );
}
