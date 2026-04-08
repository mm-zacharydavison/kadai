import { Box, Text } from "ink";

export function StatusBar() {
  const hints = "↑↓/j/k navigate  / search  esc back  q quit";

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text dimColor>{hints}</Text>
    </Box>
  );
}
