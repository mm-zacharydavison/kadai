import { SelectPhase } from "./SelectPhase.tsx";

const options = [
  { label: "Create a new repo on GitHub", value: "create" },
  { label: "Use an existing repo", value: "existing" },
];

export function ChooseRepoSetupPhase({
  onSelect,
  onEscape,
}: {
  onSelect: (value: string) => void;
  onEscape?: () => void;
}) {
  return (
    <SelectPhase
      question="Shared repo setup"
      options={options}
      onChange={onSelect}
      onEscape={onEscape}
    />
  );
}
