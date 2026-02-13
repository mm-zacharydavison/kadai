import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Spinner } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { getGitHubUsername } from "../../core/git-utils.ts";
import { type ShareResult, shareToSource } from "../../core/share.ts";
import { useActionRunner } from "../../hooks/useActionRunner.ts";
import { useRefState } from "../../hooks/useRefState.ts";
import type { Action, SourceConfig, XcliConfig } from "../../types.ts";
import { PickPathStep } from "./PickPathStep.tsx";
import { PickSourceStep } from "./PickSourceStep.tsx";
import { ShareResultView } from "./ShareResultView.tsx";
import { TestRunOutput } from "./TestRunOutput.tsx";
import { TestRunPrompt } from "./TestRunPrompt.tsx";

type Step =
  | "test-run"
  | "test-run-output"
  | "pick-source"
  | "pick-path"
  | "sharing"
  | "share-result";

interface ShareScreenProps {
  newActions: Action[];
  sources: SourceConfig[];
  cwd: string;
  config?: XcliConfig;
  xcliDir?: string;
  /** Fetch the current user's GitHub username. Defaults to gh CLI lookup. */
  fetchUsername?: () => Promise<string | null>;
  onDone: (result?: { source?: SourceConfig; targetPath: string }) => void;
}

export function ShareScreen({
  newActions,
  sources,
  cwd,
  config,
  xcliDir,
  fetchUsername = getGitHubUsername,
  onDone,
}: ShareScreenProps) {
  const org = config?.org;
  const [resolvedUserName, setResolvedUserName] = useState<string | undefined>(
    undefined,
  );

  const afterTestRun: Step = sources.length > 0 ? "pick-source" : "pick-path";
  const initialStep: Step = newActions.length > 0 ? "test-run" : afterTestRun;

  const [step, setStep] = useState<Step>(initialStep);
  const stepRef = useRef(step);
  const [selectedSource, setSelectedSource] = useState<SourceConfig | null>(
    null,
  );
  const [customPathMode, customPathModeRef, setCustomPathMode] =
    useRefState(false);

  // Test-run state
  const [testRunIndex, setTestRunIndex] = useState(0);
  const testRunIndexRef = useRef(testRunIndex);

  const testRunAction =
    step === "test-run-output" ? (newActions[testRunIndex] ?? null) : null;
  const testRun = useActionRunner({
    action: testRunAction,
    cwd,
    config,
    enabled: step === "test-run-output",
  });

  // Share result state
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);

  useEffect(() => {
    fetchUsername().then((ghUsername) => {
      if (ghUsername) {
        setResolvedUserName(ghUsername);
      }
    });
  }, [fetchUsername]);

  const defaultPath = buildDefaultPath(org, resolvedUserName);

  const sourceSelectOptions = [
    { label: "Keep in .xcli", value: "__keep__" },
    ...sources.map((s) => ({ label: `Push to ${s.repo}`, value: s.repo })),
  ];

  const existingDirs = getSourceRepoDirs(xcliDir, selectedSource);
  const pathOptions = buildPathOptions(defaultPath, org, existingDirs);
  const pathSelectOptions = pathOptions.map((opt) =>
    opt.value === "__custom__"
      ? { label: "Custom...", value: "__custom__" }
      : opt,
  );

  const updateStep = (s: Step) => {
    stepRef.current = s;
    setStep(s);
  };
  const updateTestRunIndex = (i: number) => {
    testRunIndexRef.current = i;
    setTestRunIndex(i);
  };
  const advancePastTestRun = () => {
    updateStep(afterTestRun);
  };

  const advanceToNextAction = () => {
    const nextIndex = testRunIndexRef.current + 1;
    if (nextIndex >= newActions.length) {
      advancePastTestRun();
    } else {
      updateTestRunIndex(nextIndex);
      updateStep("test-run");
    }
  };

  const startTestRun = () => {
    updateStep("test-run-output");
  };

  const doShare = (source: SourceConfig | undefined, targetPath: string) => {
    if (!source || !xcliDir) {
      onDone({ source, targetPath });
      return;
    }

    updateStep("sharing");

    const sourceRepoPath = getSourceRepoPath(xcliDir, source);
    if (!sourceRepoPath) {
      onDone({ source, targetPath });
      return;
    }

    shareToSource({
      actions: newActions,
      sourceRepoPath,
      targetPath,
      share: config?.share,
    }).then((result) => {
      setShareResult(result);
      updateStep("share-result");
    });
  };

  const onSourceSelect = (value: string) => {
    if (value === "__keep__") {
      setSelectedSource(null);
    } else {
      const source = sources.find((s) => s.repo === value);
      setSelectedSource(source ?? null);
    }
    setCustomPathMode(false);
    updateStep("pick-path");
  };

  const onPathSelect = (value: string) => {
    if (value === "__custom__") {
      setCustomPathMode(true);
      return;
    }
    doShare(selectedSource ?? undefined, value);
  };

  const onCustomPathSubmit = (value: string) => {
    const path = value.trim();
    if (path) {
      doShare(selectedSource ?? undefined, path);
    }
  };

  // Input handler for non-Select steps
  useInput(
    (input, key) => {
      const curStep = stepRef.current;

      if (curStep === "share-result") {
        if (key.return || key.escape) {
          onDone();
        }
        return;
      }

      if (curStep === "sharing") return;

      if (curStep === "test-run") {
        if (key.return) {
          startTestRun();
          return;
        }
        if (input === "s" || key.escape) {
          advancePastTestRun();
          return;
        }
        return;
      }

      if (curStep === "test-run-output") {
        if (input === "s" || key.escape) {
          advancePastTestRun();
          return;
        }
        if (key.return && testRun.doneRef.current) {
          advanceToNextAction();
          return;
        }
        return;
      }
    },
    {
      isActive:
        step === "test-run" ||
        step === "test-run-output" ||
        step === "sharing" ||
        step === "share-result",
    },
  );

  // ─── Render ───

  if (step === "test-run") {
    const action = newActions[testRunIndex];
    if (!action) return null;
    return (
      <TestRunPrompt
        action={action}
        current={testRunIndex + 1}
        total={newActions.length}
      />
    );
  }

  if (step === "test-run-output") {
    const action = newActions[testRunIndex];
    if (!action) return null;
    return (
      <TestRunOutput
        action={action}
        current={testRunIndex + 1}
        total={newActions.length}
        lines={testRun.lines}
        running={testRun.running}
        exitCode={testRun.exitCode}
        hasMoreActions={testRunIndex < newActions.length - 1}
      />
    );
  }

  if (step === "sharing") {
    return (
      <Box flexDirection="column">
        <Spinner label="Sharing actions..." />
      </Box>
    );
  }

  if (step === "share-result" && shareResult) {
    return <ShareResultView result={shareResult} />;
  }

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

      {step === "pick-source" && (
        <PickSourceStep
          options={sourceSelectOptions}
          onSelect={onSourceSelect}
          onEscape={() => onDone()}
        />
      )}

      {step === "pick-path" && (
        <PickPathStep
          options={pathSelectOptions}
          customPathMode={customPathMode}
          onSelect={onPathSelect}
          onCustomSubmit={onCustomPathSubmit}
          onEscape={() => {
            if (customPathModeRef.current) {
              setCustomPathMode(false);
              return;
            }
            if (sources.length > 0) {
              updateStep("pick-source");
              return;
            }
            onDone();
          }}
        />
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {step === "pick-path" && customPathMode
            ? "Type a path, enter to confirm, esc to go back"
            : "Press enter to confirm, esc to go back"}
        </Text>
      </Box>
    </Box>
  );
}

function buildDefaultPath(org?: string, userName?: string): string {
  if (!org) return "actions";
  const parts = ["actions", `@${org}`];
  if (userName) parts.push(userName);
  return parts.join("/");
}

function buildPathOptions(
  defaultPath: string,
  org?: string,
  existingDirs: string[] = [],
): { label: string; value: string }[] {
  const options: { label: string; value: string }[] = [];
  const seen = new Set<string>();

  if (org && defaultPath !== "actions") {
    options.push({ label: defaultPath, value: defaultPath });
    seen.add(defaultPath);
  }

  if (!seen.has("actions")) {
    options.push({ label: "actions/", value: "actions" });
    seen.add("actions");
  }

  for (const dir of existingDirs) {
    const path = `actions/${dir}`;
    if (!seen.has(path)) {
      options.push({ label: `actions/${dir}/`, value: path });
      seen.add(path);
    }
  }

  options.push({ label: "__custom__", value: "__custom__" });

  return options;
}

function getSourceRepoDirs(
  xcliDir?: string,
  source?: SourceConfig | null,
): string[] {
  if (!xcliDir || !source) return [];
  const repoPath = getSourceRepoPath(xcliDir, source);
  if (!repoPath) return [];

  try {
    const actionsDir = join(repoPath, "actions");
    const entries = readdirSync(actionsDir);
    return entries.filter((e) => {
      try {
        return statSync(join(actionsDir, e)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function getSourceRepoPath(
  xcliDir: string,
  source: SourceConfig,
): string | null {
  const ref = source.ref ?? "main";
  const cacheKey = `${source.repo.replace("/", "-")}-${ref}`;
  const cachePath = join(xcliDir, ".cache", "sources", cacheKey);
  try {
    statSync(cachePath);
    return cachePath;
  } catch {
    return null;
  }
}
