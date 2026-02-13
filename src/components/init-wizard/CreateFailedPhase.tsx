import { Box, Text } from "ink";
import { SelectPhase } from "./SelectPhase.tsx";

const options = [
  { label: "I have a different repo", value: "different-repo" },
  {
    label: "No shared repo — just use local .xcli/actions/",
    value: "local",
  },
];

export function CreateFailedPhase({
  error,
  onSelect,
  onEscape,
}: {
  error: string | null;
  onSelect: (value: string) => void;
  onEscape?: () => void;
}) {
  return (
    <Box flexDirection="column">
      {error && (
        <Box marginBottom={1}>
          <Text color="red">
            {"✗ "}
            {error}
          </Text>
        </Box>
      )}
      <SelectPhase
        question="What would you like to do?"
        options={options}
        onChange={onSelect}
        onEscape={onEscape}
      />
    </Box>
  );
}
