import { Box, Text } from "ink";
import { useActionRunner } from "../hooks/useActionRunner.ts";
import type { Action, ZcliConfig } from "../types.ts";

interface ActionOutputProps {
  action: Action;
  cwd: string;
  config?: ZcliConfig;
  onRunningChange?: (running: boolean) => void;
}

export function ActionOutput({
  action,
  cwd,
  config,
  onRunningChange,
}: ActionOutputProps) {
  const { lines, exitCode, running } = useActionRunner({
    action,
    cwd,
    config,
    onRunningChange,
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          {action.meta.emoji ? `${action.meta.emoji} ` : ""}
          {action.meta.name}
        </Text>
      </Box>
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      {running && <Text dimColor>Running...</Text>}
      {!running && exitCode !== null && (
        <Box marginTop={1}>
          <Text color={exitCode === 0 ? "green" : "red"}>
            {exitCode === 0 ? "✓" : "✗"} exit code {exitCode}
          </Text>
        </Box>
      )}
    </Box>
  );
}
