import { SelectPhase } from "./SelectPhase.tsx";

const options = [
  { label: "Yes (requires Claude CLI)", value: "yes" },
  { label: "No", value: "no" },
];

export function ChooseAiPhase({
  onSelect,
  onEscape,
}: {
  onSelect: (value: string) => void;
  onEscape?: () => void;
}) {
  return (
    <SelectPhase
      question="Enable AI action generation?"
      options={options}
      onChange={onSelect}
      onEscape={onEscape}
    />
  );
}
