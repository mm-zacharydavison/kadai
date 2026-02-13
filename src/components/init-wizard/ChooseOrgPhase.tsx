import type { OrgInfo } from "../../core/init-wizard.ts";
import { SelectPhase } from "./SelectPhase.tsx";

export function ChooseOrgPhase({
  orgs,
  ghUsername,
  onSelect,
  onEscape,
}: {
  orgs: OrgInfo[];
  ghUsername: string | null;
  onSelect: (value: string) => void;
  onEscape?: () => void;
}) {
  const options = [
    ...(ghUsername
      ? [
          {
            label: `Personal (${ghUsername}/xcli-actions)`,
            value: ghUsername,
          },
        ]
      : []),
    ...orgs.map((o) => ({
      label: `${o.login} (${o.login}/xcli-actions)`,
      value: o.login,
    })),
  ];

  return (
    <SelectPhase
      question="Where should the repo be created?"
      options={options}
      onChange={onSelect}
      onEscape={onEscape}
    />
  );
}
