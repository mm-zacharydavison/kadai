import { Box, Text } from "ink";
import type { Action } from "../../types.ts";

export function TestRunPrompt({
  action,
  current,
  total,
}: {
  action: Action;
  current: number;
  total: number;
}) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          Test run ({current}/{total})
        </Text>
      </Box>

      <Text>
        {action.meta.emoji ? `${action.meta.emoji} ` : ""}
        {action.meta.name}
        {action.meta.description && (
          <Text dimColor> ({action.meta.description})</Text>
        )}
      </Text>

      <Box marginTop={1}>
        <Text dimColor>Press enter to run, s to skip</Text>
      </Box>
    </Box>
  );
}
