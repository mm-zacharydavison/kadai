import { Box, Text } from "ink";
import type { ReviewerOption } from "../../core/init-wizard.ts";
import { FuzzyMultiSelect } from "../FuzzyMultiSelect.tsx";

export function ChooseReviewerPhase({
  reviewerOptions,
  onSubmit,
  onEscape,
}: {
  reviewerOptions: ReviewerOption[];
  onSubmit: (values: string[]) => void;
  onEscape?: () => void;
}) {
  const options = reviewerOptions.map((opt) => ({
    label: opt.type === "team" ? `${opt.label} (team)` : opt.label,
    value: opt.value,
  }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>? Who should review PRs?</Text>
      </Box>
      <FuzzyMultiSelect
        options={options}
        onSubmit={onSubmit}
        onEscape={onEscape}
      />
    </Box>
  );
}
