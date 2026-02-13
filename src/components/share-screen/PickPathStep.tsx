import { TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { FuzzySelect } from "../FuzzySelect.tsx";

export function PickPathStep({
  options,
  customPathMode,
  onSelect,
  onCustomSubmit,
  onEscape,
}: {
  options: { label: string; value: string }[];
  customPathMode: boolean;
  onSelect: (value: string) => void;
  onCustomSubmit: (value: string) => void;
  onEscape?: () => void;
}) {
  useInput(
    (_input, key) => {
      if (key.escape) {
        onEscape?.();
      }
    },
    { isActive: customPathMode },
  );

  if (customPathMode) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Destination path:</Text>
        </Box>
        <TextInput placeholder="actions/your/path" onSubmit={onCustomSubmit} />
      </Box>
    );
  }

  return (
    <Box marginTop={1} flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Destination path:</Text>
      </Box>
      <FuzzySelect options={options} onChange={onSelect} onEscape={onEscape} />
    </Box>
  );
}
