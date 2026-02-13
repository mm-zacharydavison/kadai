import { TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";

export function EnterReviewerPhase({
  onSubmit,
  onEscape,
}: {
  onSubmit: (value: string) => void;
  onEscape?: () => void;
}) {
  useInput((_input, key) => {
    if (key.escape) {
      onEscape?.();
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          ? Who should review PRs? (comma-separated, blank for none)
        </Text>
      </Box>
      <Box>
        <Text>{"  > "}</Text>
        <TextInput placeholder="alice, bob" onSubmit={onSubmit} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>enter submit esc back</Text>
      </Box>
    </Box>
  );
}
