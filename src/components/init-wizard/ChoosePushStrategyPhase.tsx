import { SelectPhase } from "./SelectPhase.tsx";

const options = [
  { label: "Push directly to the default branch", value: "push" },
  { label: "Push to an xcli-actions branch", value: "branch" },
  { label: "Create a pull request", value: "pr" },
];

export function ChoosePushStrategyPhase({
  onSelect,
  onEscape,
}: {
  onSelect: (value: string) => void;
  onEscape?: () => void;
}) {
  return (
    <SelectPhase
      question="How should changes be pushed?"
      options={options}
      onChange={onSelect}
      onEscape={onEscape}
    />
  );
}
