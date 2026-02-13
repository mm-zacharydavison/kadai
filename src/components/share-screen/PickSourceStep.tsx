import { Box, Text } from "ink";
import { FuzzySelect } from "../FuzzySelect.tsx";

export function PickSourceStep({
  options,
  onSelect,
  onEscape,
}: {
  options: { label: string; value: string }[];
  onSelect: (value: string) => void;
  onEscape?: () => void;
}) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Share to:</Text>
      </Box>
      <FuzzySelect options={options} onChange={onSelect} onEscape={onEscape} />
    </Box>
  );
}
