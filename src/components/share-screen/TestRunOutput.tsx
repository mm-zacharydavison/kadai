import { Box, Text } from "ink";
import type { Action } from "../../types.ts";

export function TestRunOutput({
  action,
  current,
  total,
  lines,
  running,
  exitCode,
  hasMoreActions,
}: {
  action: Action;
  current: number;
  total: number;
  lines: string[];
  running: boolean;
  exitCode: number | null;
  hasMoreActions: boolean;
}) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          Test run ({current}/{total})
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text bold>
          {action.meta.emoji ? `${action.meta.emoji} ` : ""}
          {action.meta.name}
        </Text>
      </Box>

      {lines.map((line, i) => (
        <Text key={`${i}`}>{line}</Text>
      ))}

      {running && <Text dimColor>Running...</Text>}
      {!running && exitCode !== null && (
        <Box marginTop={1}>
          <Text color={exitCode === 0 ? "green" : "red"}>
            {exitCode === 0 ? "✓" : "✗"} exit code {exitCode}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {!running
            ? hasMoreActions
              ? "Press enter to continue, s to skip remaining"
              : "Press enter to continue"
            : "Running... press s to skip"}
        </Text>
      </Box>
    </Box>
  );
}
