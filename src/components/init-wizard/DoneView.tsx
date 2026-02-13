import { Box, Text } from "ink";

export function DoneView({
  aiEnabled,
  sampleCreated,
  branchProtectionWarning,
}: {
  aiEnabled: boolean;
  sampleCreated: boolean;
  branchProtectionWarning: string | null;
}) {
  return (
    <Box flexDirection="column">
      {aiEnabled && (
        <Box marginBottom={1}>
          <Text color="green">✓ AI generation enabled</Text>
        </Box>
      )}
      {branchProtectionWarning && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ {branchProtectionWarning}</Text>
        </Box>
      )}
      {sampleCreated && (
        <Text>Creating .xcli/actions/ with a sample action...</Text>
      )}
      <Text>Writing .xcli/config.ts...</Text>
      <Text>Done! Run xcli again to get started.</Text>
    </Box>
  );
}
