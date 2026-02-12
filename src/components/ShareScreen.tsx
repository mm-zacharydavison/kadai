import { Box, Text, useInput } from "ink";
import { useRef, useState } from "react";
import type { Action, SourceConfig } from "../types.ts";

type Step = "pick-source" | "pick-path" | "custom-path";

interface ShareScreenProps {
  newActions: Action[];
  sources: SourceConfig[];
  /** Default org name for scoping (from git remote) */
  org?: string;
  /** Current git user name for default path */
  userName?: string;
  onDone: (result?: { source?: SourceConfig; targetPath: string }) => void;
}

export function ShareScreen({
  newActions,
  sources,
  org,
  userName,
  onDone,
}: ShareScreenProps) {
  // Skip source picker if no external sources — go straight to path
  const initialStep: Step = sources.length > 0 ? "pick-source" : "pick-path";
  const [step, setStep] = useState<Step>(initialStep);
  const stepRef = useRef(step);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(selectedIndex);
  const [selectedSource, setSelectedSource] = useState<SourceConfig | null>(
    null,
  );
  const selectedSourceRef = useRef(selectedSource);
  const [customPath, setCustomPath] = useState("");
  const customPathRef = useRef(customPath);

  const defaultPath = buildDefaultPath(org, userName);

  const sourceOptions = [
    { label: "Keep in .xcli", value: undefined as string | undefined },
    ...sources.map((s) => ({ label: `Push to ${s.repo}`, value: s.repo })),
  ];

  const pathOptions = [
    { label: defaultPath, value: defaultPath },
    { label: "Somewhere else...", value: "__custom__" },
  ];

  const updateStep = (s: Step) => {
    stepRef.current = s;
    setStep(s);
  };
  const updateIndex = (i: number) => {
    selectedIndexRef.current = i;
    setSelectedIndex(i);
  };
  const updateSource = (s: SourceConfig | null) => {
    selectedSourceRef.current = s;
    setSelectedSource(s);
  };
  const updateCustomPath = (p: string) => {
    customPathRef.current = p;
    setCustomPath(p);
  };

  useInput((input, key) => {
    const curStep = stepRef.current;
    const curIndex = selectedIndexRef.current;

    if (key.escape) {
      if (curStep === "custom-path") {
        updateStep("pick-path");
        updateCustomPath("");
        return;
      }
      if (curStep === "pick-path") {
        if (sources.length > 0) {
          updateStep("pick-source");
          updateIndex(0);
          return;
        }
        onDone();
        return;
      }
      onDone();
      return;
    }

    if (curStep === "custom-path") {
      if (key.return) {
        const path = customPathRef.current.trim();
        if (path) {
          const source = selectedSourceRef.current;
          onDone({ source: source ?? undefined, targetPath: path });
        }
        return;
      }
      if (key.backspace || key.delete) {
        updateCustomPath(customPathRef.current.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        updateCustomPath(customPathRef.current + input);
      }
      return;
    }

    if (key.return) {
      if (curStep === "pick-source") {
        const selected = sourceOptions[curIndex];
        if (!selected?.value) {
          // "Keep in .xcli" — no external source, go to path picker
          updateSource(null);
        } else {
          const source = sources.find((s) => s.repo === selected.value);
          updateSource(source ?? null);
        }
        updateIndex(0);
        updateStep("pick-path");
        return;
      }
      if (curStep === "pick-path") {
        const selected = pathOptions[curIndex];
        if (selected?.value === "__custom__") {
          updateCustomPath(defaultPath);
          updateStep("custom-path");
          return;
        }
        if (selected) {
          const source = selectedSourceRef.current;
          onDone({
            source: source ?? undefined,
            targetPath: selected.value,
          });
        }
        return;
      }
    }

    if (key.upArrow || input === "k") {
      updateIndex(Math.max(0, curIndex - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      const maxIndex =
        curStep === "pick-source"
          ? sourceOptions.length - 1
          : pathOptions.length - 1;
      updateIndex(Math.min(maxIndex, curIndex + 1));
      return;
    }
  });

  const options = step === "pick-source" ? sourceOptions : pathOptions;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>New actions created:</Text>
      </Box>

      {newActions.map((action) => (
        <Box key={action.id}>
          <Text>
            {"  "}✦ {action.meta.emoji ? `${action.meta.emoji} ` : ""}
            {action.meta.name}
          </Text>
          <Text dimColor>{`  (${action.filePath})`}</Text>
        </Box>
      ))}

      {(step === "pick-source" || step === "pick-path") && (
        <Box marginTop={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>
              {step === "pick-source" ? "Share to:" : "Destination path:"}
            </Text>
          </Box>
          {options.map((opt, i) => (
            <Text
              key={opt.label}
              color={i === selectedIndex ? "cyan" : undefined}
            >
              {i === selectedIndex ? "❯ " : "  "}
              {opt.label}
            </Text>
          ))}
        </Box>
      )}

      {step === "custom-path" && (
        <Box marginTop={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Enter destination path:</Text>
          </Box>
          <Box>
            <Text>
              {"  "}
              {customPath}
            </Text>
            <Text dimColor>█</Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {step === "custom-path"
            ? "Type a path, enter to confirm, esc to go back"
            : "Press enter to confirm, esc to go back"}
        </Text>
      </Box>
    </Box>
  );
}

function buildDefaultPath(org?: string, userName?: string): string {
  const parts = ["actions"];
  if (org) parts.push(`@${org}`);
  if (userName) parts.push(userName);
  return parts.join("/");
}
