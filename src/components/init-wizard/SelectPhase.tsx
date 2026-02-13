import { Box, Text } from "ink";
import { FuzzySelect } from "../FuzzySelect.tsx";

export function SelectPhase({
  question,
  options,
  onChange,
  onEscape,
}: {
  question: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  onEscape?: () => void;
}) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>? {question}</Text>
      </Box>
      <FuzzySelect options={options} onChange={onChange} onEscape={onEscape} />
    </Box>
  );
}
