import { Spinner, TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";

export function EnterRepoPhase({
  validating,
  error,
  onSubmit,
  onEscape,
}: {
  validating: boolean;
  error: string | null;
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
        <Text bold>? Repo (org/name):</Text>
      </Box>
      <Box>
        <Text>{"  > "}</Text>
        <TextInput
          placeholder="org/repo"
          onSubmit={onSubmit}
          isDisabled={validating}
        />
      </Box>
      {validating && (
        <Box marginTop={1}>
          <Spinner label="Validating..." />
        </Box>
      )}
      {error && (
        <Box marginTop={1}>
          <Text color="red">
            {"  "}
            {error}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>enter submit esc back</Text>
      </Box>
    </Box>
  );
}
