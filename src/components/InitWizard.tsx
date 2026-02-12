import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useRef, useState } from "react";
import {
  createXcliActionsRepo,
  detectAiCli,
  detectXcliActionsRepo,
  type InitDeps,
  type InitResult,
  validateRepo,
  writeInitFiles,
} from "../core/init-wizard.ts";
import type { SourceConfig } from "../types.ts";

type Phase =
  | "detecting"
  | "choose-source"
  | "enter-repo"
  | "creating-repo"
  | "create-failed"
  | "writing"
  | "done";

interface DetectionResult {
  owner: string | null;
  xcliActionsRepo: { repo: string; defaultBranch: string } | null;
  aiEnabled: boolean;
}

interface InitWizardProps {
  cwd: string;
  deps: InitDeps;
  detectRepoIdentity: (cwd: string) => Promise<{ org: string } | null>;
  onDone: (result: InitResult) => void;
}

export function InitWizard({
  cwd,
  deps,
  detectRepoIdentity,
  onDone,
}: InitWizardProps) {
  const [phase, setPhase] = useState<Phase>("detecting");
  const phaseRef = useRef<Phase>("detecting");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);

  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const detectionRef = useRef<DetectionResult | null>(null);
  const [, setSources] = useState<SourceConfig[]>([]);
  const sourcesRef = useRef<SourceConfig[]>([]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const aiEnabledRef = useRef(false);

  const [repoInput, setRepoInput] = useState("");
  const repoInputRef = useRef("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoValidating, setRepoValidating] = useState(false);

  const [createError, setCreateError] = useState<string | null>(null);

  const [writeResult, setWriteResult] = useState<{
    sampleCreated: boolean;
  } | null>(null);

  const updatePhase = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const updateIndex = (i: number) => {
    selectedIndexRef.current = i;
    setSelectedIndex(i);
  };
  const updateSources = (s: SourceConfig[]) => {
    sourcesRef.current = s;
    setSources(s);
  };
  const updateRepoInput = (v: string) => {
    repoInputRef.current = v;
    setRepoInput(v);
  };

  // Phase 1: detect environment on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [repoIdentity, ai] = await Promise.all([
        detectRepoIdentity(cwd),
        detectAiCli(deps),
      ]);
      if (cancelled) return;
      const owner = repoIdentity?.org ?? null;

      let xcliActionsRepo: { repo: string; defaultBranch: string } | null =
        null;
      if (owner) {
        xcliActionsRepo = await detectXcliActionsRepo(owner, deps);
      }
      if (cancelled) return;

      const det: DetectionResult = { owner, xcliActionsRepo, aiEnabled: ai };
      detectionRef.current = det;
      setDetection(det);
      aiEnabledRef.current = ai;
      setAiEnabled(ai);
      selectedIndexRef.current = 0;
      setSelectedIndex(0);
      phaseRef.current = "choose-source";
      setPhase("choose-source");
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, deps, detectRepoIdentity]);

  // Build the options list for "choose-source" based on detection
  const sourceOptions = buildSourceOptions(detection);

  useInput((input, key) => {
    const cur = phaseRef.current;

    // ─── enter-repo: text input ───
    if (cur === "enter-repo") {
      if (repoValidating) return;
      if (key.escape) {
        updateRepoInput("");
        setRepoError(null);
        updateIndex(0);
        updatePhase("choose-source");
        return;
      }
      if (key.return) {
        const repo = repoInputRef.current.trim();
        if (!repo) return;
        setRepoValidating(true);
        setRepoError(null);
        validateRepo(repo, deps).then((result) => {
          setRepoValidating(false);
          if (result.valid) {
            const src: SourceConfig = { repo };
            if (result.defaultBranch && result.defaultBranch !== "main") {
              src.ref = result.defaultBranch;
            }
            updateSources([src]);
            startWriting();
          } else {
            setRepoError(`Could not find "${repo}" on GitHub.`);
          }
        });
        return;
      }
      if (key.backspace || key.delete) {
        updateRepoInput(repoInputRef.current.slice(0, -1));
        setRepoError(null);
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        updateRepoInput(repoInputRef.current + input);
        setRepoError(null);
      }
      return;
    }

    // ─── create-failed: fallback selection ───
    if (cur === "create-failed") {
      if (key.upArrow) {
        updateIndex(Math.max(0, selectedIndexRef.current - 1));
        return;
      }
      if (key.downArrow) {
        updateIndex(Math.min(1, selectedIndexRef.current + 1));
        return;
      }
      if (key.return) {
        if (selectedIndexRef.current === 0) {
          updateRepoInput("");
          setRepoError(null);
          updatePhase("enter-repo");
        } else {
          updateSources([]);
          startWriting();
        }
        return;
      }
      return;
    }

    // ─── choose-source: arrow-key selection ───
    if (cur === "choose-source") {
      if (key.upArrow) {
        updateIndex(Math.max(0, selectedIndexRef.current - 1));
        return;
      }
      if (key.downArrow) {
        updateIndex(
          Math.min(sourceOptions.length - 1, selectedIndexRef.current + 1),
        );
        return;
      }
      if (key.return) {
        handleSourceSelection(selectedIndexRef.current);
        return;
      }
      return;
    }
  });

  function handleSourceSelection(index: number) {
    const det = detectionRef.current;
    if (!det) return;
    const option = sourceOptions[index];
    if (!option) return;

    if (option.action === "accept-detected") {
      const repo = det.xcliActionsRepo;
      if (!repo) return;
      const src: SourceConfig = { repo: repo.repo };
      if (repo.defaultBranch !== "main") {
        src.ref = repo.defaultBranch;
      }
      updateSources([src]);
      startWriting();
    } else if (option.action === "create-repo") {
      const owner = det.owner;
      if (!owner) return;
      updatePhase("creating-repo");
      createXcliActionsRepo(owner, deps).then((result) => {
        if (result.success) {
          const src: SourceConfig = { repo: result.repo };
          if (result.defaultBranch !== "main") {
            src.ref = result.defaultBranch;
          }
          updateSources([src]);
          startWriting();
        } else {
          if (result.permissionError) {
            setCreateError(
              `Could not create ${owner}/xcli-actions: insufficient permissions.\n` +
                `  Ask an org admin to create the repo, or visit:\n` +
                `  https://github.com/organizations/${owner}/repositories/new`,
            );
          } else {
            setCreateError(`Could not create ${owner}/xcli-actions.`);
          }
          updateIndex(0);
          updatePhase("create-failed");
        }
      });
    } else if (option.action === "enter-custom") {
      updateRepoInput("");
      setRepoError(null);
      updatePhase("enter-repo");
    } else if (option.action === "no-source") {
      updateSources([]);
      startWriting();
    }
  }

  function startWriting() {
    updatePhase("writing");
    writeInitFiles(cwd, sourcesRef.current, aiEnabledRef.current).then(
      (result) => {
        setWriteResult(result);
        updatePhase("done");
        onDone({
          xcliDir: `${cwd}/.xcli`,
          sources: sourcesRef.current,
          aiEnabled: aiEnabledRef.current,
        });
      },
    );
  }

  // ─── Render ───

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}>
        <Text>No .xcli directory found. Let's set one up.</Text>
      </Box>

      {phase === "detecting" && (
        <Box>
          <Text>
            <Spinner type="dots" /> Detecting environment...
          </Text>
        </Box>
      )}

      {phase === "choose-source" && detection && (
        <ChooseSourceView
          detection={detection}
          options={sourceOptions}
          selectedIndex={selectedIndex}
        />
      )}

      {phase === "enter-repo" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>? Repo (org/name):</Text>
          </Box>
          <Box>
            <Text>
              {"  "}
              {">"} {repoInput}
            </Text>
            <Text dimColor>█</Text>
          </Box>
          {repoValidating && (
            <Box marginTop={1}>
              <Text>
                <Spinner type="dots" /> Validating...
              </Text>
            </Box>
          )}
          {repoError && (
            <Box marginTop={1}>
              <Text color="red">
                {"  "}
                {repoError}
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>enter submit esc back</Text>
          </Box>
        </Box>
      )}

      {phase === "creating-repo" && detection?.owner && (
        <Box>
          <Text>
            <Spinner type="dots" /> Creating {detection.owner}/xcli-actions on
            GitHub...
          </Text>
        </Box>
      )}

      {phase === "create-failed" && (
        <Box flexDirection="column">
          {createError && (
            <Box marginBottom={1}>
              <Text color="red">
                {"✗ "}
                {createError}
              </Text>
            </Box>
          )}
          <Box marginBottom={1}>
            <Text bold>? What would you like to do?</Text>
          </Box>
          {[
            "I have a different repo",
            "No shared repo — just use local .xcli/actions/",
          ].map((label, i) => (
            <Text key={label} color={i === selectedIndex ? "cyan" : undefined}>
              {i === selectedIndex ? "❯ " : "  "}
              {label}
            </Text>
          ))}
          <Box marginTop={1}>
            <Text dimColor>↑↓ navigate enter select</Text>
          </Box>
        </Box>
      )}

      {phase === "writing" && (
        <Box>
          <Text>
            <Spinner type="dots" /> Writing files...
          </Text>
        </Box>
      )}

      {phase === "done" && (
        <DoneView
          aiEnabled={aiEnabled}
          sampleCreated={writeResult?.sampleCreated ?? false}
        />
      )}
    </Box>
  );
}

// ─── Sub-views ───

interface SourceOption {
  label: string;
  action: "accept-detected" | "create-repo" | "enter-custom" | "no-source";
  recommended?: boolean;
}

function buildSourceOptions(detection: DetectionResult | null): SourceOption[] {
  if (!detection) return [];
  const { owner, xcliActionsRepo } = detection;

  if (owner && xcliActionsRepo) {
    return [
      {
        label: `Yes, use ${xcliActionsRepo.repo}`,
        action: "accept-detected",
        recommended: true,
      },
      { label: "I have a different repo", action: "enter-custom" },
      {
        label: "No shared repo — just use local .xcli/actions/",
        action: "no-source",
      },
    ];
  }

  if (owner && !xcliActionsRepo) {
    return [
      {
        label: `Create ${owner}/xcli-actions on GitHub`,
        action: "create-repo",
      },
      { label: "I have a different repo", action: "enter-custom" },
      {
        label: "No shared repo — just use local .xcli/actions/",
        action: "no-source",
      },
    ];
  }

  // No owner (no git remote)
  return [
    { label: "Yes, let me enter it", action: "enter-custom" },
    {
      label: "No, just use local .xcli/actions/",
      action: "no-source",
    },
  ];
}

function ChooseSourceView({
  detection,
  options,
  selectedIndex,
}: {
  detection: DetectionResult;
  options: SourceOption[];
  selectedIndex: number;
}) {
  const { owner, xcliActionsRepo } = detection;

  let contextLine: string | null = null;
  if (owner && xcliActionsRepo) {
    contextLine = `Detected a shared actions repo: ${xcliActionsRepo.repo}`;
  } else if (owner && !xcliActionsRepo) {
    contextLine = `No shared actions repo found for "${owner}".`;
  }

  const questionText =
    owner && xcliActionsRepo
      ? "? Use it as a source for shared actions?"
      : owner
        ? "? What would you like to do?"
        : "? Do you have a shared xcli actions repo?";

  return (
    <Box flexDirection="column">
      {contextLine && (
        <Box marginBottom={1}>
          <Text>{contextLine}</Text>
        </Box>
      )}
      <Box marginBottom={1}>
        <Text bold>{questionText}</Text>
      </Box>
      {options.map((opt, i) => (
        <Text key={opt.label} color={i === selectedIndex ? "cyan" : undefined}>
          {i === selectedIndex ? "❯ " : "  "}
          {opt.label}
          {opt.recommended ? " (recommended)" : ""}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate enter select</Text>
      </Box>
    </Box>
  );
}

function DoneView({
  aiEnabled,
  sampleCreated,
}: {
  aiEnabled: boolean;
  sampleCreated: boolean;
}) {
  return (
    <Box flexDirection="column">
      {aiEnabled && (
        <Box marginBottom={1}>
          <Text color="green">
            ✓ AI generation enabled (Claude CLI detected)
          </Text>
        </Box>
      )}
      {sampleCreated && (
        <Text>Creating .xcli/actions/ with a sample action...</Text>
      )}
      <Text>Writing .xcli/config.ts...</Text>
      <Text>Done! Run xcli again to get started.</Text>
    </Box>
  );
}
