import { SelectPhase } from "./SelectPhase.tsx";

const options = [
  { label: "Local only (.xcli/actions/)", value: "local" },
  { label: "Shared repo", value: "shared" },
];

export function ChooseLocationPhase({
  onSelect,
  onEscape,
}: {
  onSelect: (value: string) => void;
  onEscape?: () => void;
}) {
  return (
    <SelectPhase
      question="Where should xcli actions live?"
      options={options}
      onChange={onSelect}
      onEscape={onEscape}
    />
  );
}
