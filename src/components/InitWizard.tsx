import fuzzysort from "fuzzysort";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useRef, useState } from "react";
import {
  createXcliActionsRepo,
  detectAiCli,
  fetchGitHubUsername,
  fetchOrgs,
  fetchReviewerOptions,
  type GenerateConfigOptions,
  type InitDeps,
  type InitResult,
  type OrgInfo,
  type ReviewerOption,
  setupBranchProtection,
  validateRepo,
  writeInitFiles,
} from "../core/init-wizard.ts";
import type { ShareConfig, SourceConfig } from "../types.ts";

type Phase =
  | "choose-location"
  | "choose-repo-setup"
  | "choose-org"
  | "fetching-orgs"
  | "creating-repo"
  | "create-failed"
  | "enter-repo"
  | "choose-push-strategy"
  | "fetching-members"
  | "choose-reviewer"
  | "enter-reviewer"
  | "choose-ai"
  | "writing"
  | "done";

interface InitWizardProps {
  cwd: string;
  deps: InitDeps;
  onDone: (result: InitResult) => void;
}

export function InitWizard({ cwd, deps, onDone }: InitWizardProps) {
  const [phase, setPhase] = useState<Phase>("choose-location");
  const phaseRef = useRef<Phase>("choose-location");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);

  // Collected answers
  const [, setSources] = useState<SourceConfig[]>([]);
  const sourcesRef = useRef<SourceConfig[]>([]);
  const [, setShareConfig] = useState<ShareConfig | undefined>(undefined);
  const shareConfigRef = useRef<ShareConfig | undefined>(undefined);
  const [aiEnabled, setAiEnabled] = useState(false);
  const aiEnabledRef = useRef(false);
  const [orgName, setOrgName] = useState<string | undefined>(undefined);
  const orgNameRef = useRef<string | undefined>(undefined);
  // Org list for create-repo flow
  const [, setOrgs] = useState<OrgInfo[]>([]);
  const orgsRef = useRef<OrgInfo[]>([]);
  const [, setGhUsername] = useState<string | null>(null);
  const ghUsernameRef = useRef<string | null>(null);

  // Reviewer options for multi-select
  const [, setReviewerOptions] = useState<ReviewerOption[]>([]);
  const reviewerOptionsRef = useRef<ReviewerOption[]>([]);
  const selectedReviewersRef = useRef<Set<string>>(new Set());
  const [, setSelectedReviewersVersion] = useState(0);
  const [reviewerSearch, setReviewerSearch] = useState("");
  const reviewerSearchRef = useRef("");

  // Text input state
  const [repoInput, setRepoInput] = useState("");
  const repoInputRef = useRef("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoValidating, setRepoValidating] = useState(false);
  const [reviewerInput, setReviewerInput] = useState("");
  const reviewerInputRef = useRef("");

  const [createError, setCreateError] = useState<string | null>(null);
  const [branchProtectionWarning, setBranchProtectionWarning] = useState<
    string | null
  >(null);
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
  const updateShareConfig = (s: ShareConfig | undefined) => {
    shareConfigRef.current = s;
    setShareConfig(s);
  };
  const updateRepoInput = (v: string) => {
    repoInputRef.current = v;
    setRepoInput(v);
  };
  const updateReviewerInput = (v: string) => {
    reviewerInputRef.current = v;
    setReviewerInput(v);
  };
  const updateOrgName = (v: string | undefined) => {
    orgNameRef.current = v;
    setOrgName(v);
  };
  const updateReviewerOptions = (opts: ReviewerOption[]) => {
    reviewerOptionsRef.current = opts;
    setReviewerOptions(opts);
  };
  const toggleReviewer = (value: string) => {
    const set = selectedReviewersRef.current;
    if (set.has(value)) {
      set.delete(value);
    } else {
      set.add(value);
    }
    setSelectedReviewersVersion((v) => v + 1);
  };
  const updateReviewerSearch = (v: string) => {
    reviewerSearchRef.current = v;
    setReviewerSearch(v);
  };

  // Phase 1 options: Where should actions live?
  const locationOptions = [
    { label: "Local only (.xcli/actions/)", action: "local" as const },
    { label: "Shared repo", action: "shared" as const },
  ];

  // Phase 2 options: Shared repo setup
  const repoSetupOptions = [
    { label: "Create a new repo on GitHub", action: "create" as const },
    { label: "Use an existing repo", action: "existing" as const },
  ];

  // Phase 3 options: Push strategy
  const pushStrategyOptions = [
    { label: "Push directly to the default branch", action: "push" as const },
    { label: "Push to an xcli-actions branch", action: "branch" as const },
    { label: "Create a pull request", action: "pr" as const },
  ];

  // Phase 5 options: AI
  const aiOptions = [
    { label: "Yes (requires Claude CLI)", action: "yes" as const },
    { label: "No", action: "no" as const },
  ];

  // Build org selection options for create flow
  const orgOptions = [
    ...(ghUsernameRef.current
      ? [
          {
            label: `Personal (${ghUsernameRef.current}/xcli-actions)`,
            owner: ghUsernameRef.current,
          },
        ]
      : []),
    ...orgsRef.current.map((o) => ({
      label: `${o.login} (${o.login}/xcli-actions)`,
      owner: o.login,
    })),
  ];

  // Build reviewer options from reviewer options list with fuzzysort filtering
  function getFilteredReviewerOptions(): ReviewerOption[] {
    const allOptions = reviewerOptionsRef.current;

    if (!reviewerSearchRef.current) {
      return allOptions;
    }

    const filtered = fuzzysort
      .go(reviewerSearchRef.current, allOptions, { key: "label" })
      .map((r) => r.obj);

    return filtered;
  }

  useInput((input, key) => {
    const cur = phaseRef.current;

    // ─── enter-repo: text input ───
    if (cur === "enter-repo") {
      if (repoValidating) return;
      if (key.escape) {
        updateRepoInput("");
        setRepoError(null);
        updateIndex(0);
        updatePhase("choose-repo-setup");
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
            // Extract org from repo
            const [repoOrg] = repo.split("/");
            if (repoOrg) updateOrgName(repoOrg);
            updateIndex(0);
            updatePhase("choose-push-strategy");
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

    // ─── enter-reviewer: text input fallback (comma-separated) ───
    if (cur === "enter-reviewer") {
      if (key.escape) {
        updateReviewerInput("");
        updateIndex(0);
        updatePhase("choose-push-strategy");
        return;
      }
      if (key.return) {
        const raw = reviewerInputRef.current.trim();
        const existing = shareConfigRef.current;
        if (raw) {
          const reviewers = raw
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean);
          if (reviewers.length > 0) {
            updateShareConfig({ ...existing, strategy: "pr", reviewers });
          }
        }
        updateIndex(0);
        updatePhase("choose-ai");
        return;
      }
      if (key.backspace || key.delete) {
        updateReviewerInput(reviewerInputRef.current.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        updateReviewerInput(reviewerInputRef.current + input);
      }
      return;
    }

    // ─── choose-reviewer: multi-select with checkboxes ───
    if (cur === "choose-reviewer") {
      if (key.escape) {
        updateReviewerSearch("");
        selectedReviewersRef.current = new Set();
        updateIndex(0);
        updatePhase("choose-push-strategy");
        return;
      }
      // Tab = confirm shortcut
      if (key.tab) {
        confirmReviewerSelection();
        return;
      }
      const options = getFilteredReviewerOptions();
      const doneRowIndex = options.length;
      if (key.return) {
        // Enter on "Done" row → confirm
        if (selectedIndexRef.current === doneRowIndex) {
          confirmReviewerSelection();
          return;
        }
        // Enter on an item → toggle
        const option = options[selectedIndexRef.current];
        if (option) {
          toggleReviewer(option.value);
        }
        return;
      }
      if (input === " ") {
        // Space → toggle current item (not on Done row)
        if (selectedIndexRef.current < doneRowIndex) {
          const option = options[selectedIndexRef.current];
          if (option) {
            toggleReviewer(option.value);
          }
        }
        return;
      }
      if (key.upArrow || input === "k") {
        updateIndex(Math.max(0, selectedIndexRef.current - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        updateIndex(Math.min(doneRowIndex, selectedIndexRef.current + 1));
        return;
      }
      if (key.backspace || key.delete) {
        updateReviewerSearch(reviewerSearchRef.current.slice(0, -1));
        updateIndex(0);
        return;
      }
      if (
        !key.ctrl &&
        !key.meta &&
        input &&
        input !== "j" &&
        input !== "k" &&
        input !== " "
      ) {
        updateReviewerSearch(reviewerSearchRef.current + input);
        updateIndex(0);
      }
      return;
    }

    // ─── create-failed: fallback selection ───
    if (cur === "create-failed") {
      if (key.upArrow || input === "k") {
        updateIndex(Math.max(0, selectedIndexRef.current - 1));
        return;
      }
      if (key.downArrow || input === "j") {
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
          updateIndex(0);
          updatePhase("choose-push-strategy");
        }
        return;
      }
      return;
    }

    // ─── Arrow-key + vim selection phases ───
    const arrowPhases: Record<string, { options: { label: string }[] }> = {
      "choose-location": { options: locationOptions },
      "choose-repo-setup": { options: repoSetupOptions },
      "choose-org": { options: orgOptions },
      "choose-push-strategy": { options: pushStrategyOptions },
      "choose-ai": { options: aiOptions },
    };

    const arrowConfig = arrowPhases[cur];
    if (arrowConfig) {
      if (key.upArrow || input === "k") {
        updateIndex(Math.max(0, selectedIndexRef.current - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        updateIndex(
          Math.min(
            arrowConfig.options.length - 1,
            selectedIndexRef.current + 1,
          ),
        );
        return;
      }
      if (key.return) {
        handleSelection(cur, selectedIndexRef.current);
        return;
      }
      if (key.escape) {
        handleEscape(cur);
        return;
      }
    }
  });

  function handleEscape(phase: Phase) {
    if (phase === "choose-repo-setup") {
      updateIndex(0);
      updatePhase("choose-location");
    } else if (phase === "choose-org") {
      updateIndex(0);
      updatePhase("choose-repo-setup");
    } else if (phase === "choose-push-strategy") {
      if (sourcesRef.current.length > 0) {
        updateIndex(0);
        updatePhase("choose-repo-setup");
      } else {
        updateIndex(0);
        updatePhase("choose-location");
      }
    } else if (phase === "choose-ai") {
      updateIndex(0);
      updatePhase("choose-push-strategy");
    }
  }

  function handleSelection(phase: Phase, index: number) {
    if (phase === "choose-location") {
      const option = locationOptions[index];
      if (!option) return;
      if (option.action === "local") {
        updateSources([]);
        updateIndex(0);
        updatePhase("choose-push-strategy");
      } else {
        updateIndex(0);
        updatePhase("choose-repo-setup");
      }
      return;
    }

    if (phase === "choose-repo-setup") {
      const option = repoSetupOptions[index];
      if (!option) return;
      if (option.action === "create") {
        // Fetch orgs and GitHub username
        updatePhase("fetching-orgs");
        Promise.all([fetchOrgs(deps), fetchGitHubUsername(deps)]).then(
          ([orgList, username]) => {
            orgsRef.current = orgList;
            setOrgs(orgList);
            ghUsernameRef.current = username;
            setGhUsername(username);
            updateIndex(0);
            updatePhase("choose-org");
          },
        );
      } else {
        updateRepoInput("");
        setRepoError(null);
        updatePhase("enter-repo");
      }
      return;
    }

    if (phase === "choose-org") {
      const option = orgOptions[index];
      if (!option) return;
      const owner = option.owner;
      updateOrgName(owner);
      updatePhase("creating-repo");
      createXcliActionsRepo(owner, deps).then((result) => {
        if (result.success) {
          const src: SourceConfig = { repo: result.repo };
          if (result.defaultBranch !== "main") {
            src.ref = result.defaultBranch;
          }
          updateSources([src]);
          updateIndex(0);
          updatePhase("choose-push-strategy");
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
      return;
    }

    if (phase === "choose-push-strategy") {
      const option = pushStrategyOptions[index];
      if (!option) return;
      if (option.action === "push") {
        updateShareConfig(undefined);
        updateIndex(0);
        updatePhase("choose-ai");
      } else if (option.action === "branch") {
        updateShareConfig({ strategy: "branch" });
        updateIndex(0);
        updatePhase("choose-ai");
      } else if (option.action === "pr") {
        updateShareConfig({ strategy: "pr" });
        startFetchingMembers();
      }
      return;
    }

    if (phase === "choose-ai") {
      const option = aiOptions[index];
      if (!option) return;
      const enabled = option.action === "yes";
      aiEnabledRef.current = enabled;
      setAiEnabled(enabled);

      if (enabled) {
        // Check if Claude CLI is actually installed
        const cliAvailable = detectAiCli(deps);
        cliAvailable.then((available) => {
          if (!available) {
            // Warn but still enable — they can install it later
          }
          startWriting();
        });
      } else {
        startWriting();
      }
      return;
    }
  }

  function confirmReviewerSelection() {
    const reviewers = Array.from(selectedReviewersRef.current);
    if (reviewers.length > 0) {
      updateShareConfig({
        ...shareConfigRef.current,
        strategy: "pr",
        reviewers,
      });
    }
    updateReviewerSearch("");
    selectedReviewersRef.current = new Set();
    updateIndex(0);
    updatePhase("choose-ai");
  }

  function fetchReviewersFromRepo(repo: string) {
    fetchReviewerOptions(repo, deps).then((options) => {
      if (options.length > 0) {
        updateReviewerOptions(options);
        updatePhase("choose-reviewer");
      } else {
        updateReviewerInput("");
        updatePhase("enter-reviewer");
      }
    });
  }

  function startFetchingMembers() {
    updatePhase("fetching-members");
    updateReviewerSearch("");
    selectedReviewersRef.current = new Set();
    updateIndex(0);

    const sourceRepo = sourcesRef.current[0]?.repo;
    if (sourceRepo) {
      fetchReviewersFromRepo(sourceRepo);
      return;
    }

    // No source repo — detect from current git remote
    deps.detectRepo(cwd).then((identity) => {
      if (identity) {
        fetchReviewersFromRepo(`${identity.org}/${identity.repo}`);
      } else {
        updateReviewerInput("");
        updatePhase("enter-reviewer");
      }
    });
  }

  function startWriting() {
    updatePhase("writing");

    const sources = sourcesRef.current;
    const share = shareConfigRef.current;
    const org = orgNameRef.current;

    // Build autoNavigate from source repo if available
    let autoNavigate: string[] | undefined;
    if (sources.length > 0 && org) {
      const repoName = sources[0]?.repo.split("/")[1];
      if (repoName) {
        autoNavigate = [`@${org}`, repoName];
      }
    }

    const configOptions: GenerateConfigOptions = {
      sources,
      aiEnabled: aiEnabledRef.current,
      share,
      org,
      autoNavigate,
    };

    writeInitFiles(cwd, configOptions).then(async (result) => {
      setWriteResult(result);

      // Best-effort branch protection setup
      if (share?.strategy === "pr" && sources.length > 0) {
        const [repoOwner, repoName] = (sources[0]?.repo ?? "").split("/");
        if (repoOwner && repoName) {
          const protectionOk = await setupBranchProtection(
            repoOwner,
            repoName,
            "main",
            deps,
          );
          if (!protectionOk) {
            setBranchProtectionWarning(
              "Could not set up branch protection — you may need to configure it manually.",
            );
          }
        }
      }

      updatePhase("done");
      onDone({
        xcliDir: `${cwd}/.xcli`,
        sources,
        aiEnabled: aiEnabledRef.current,
      });
    });
  }

  // ─── Render ───

  const filteredReviewerOptions = getFilteredReviewerOptions();

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}>
        <Text>No .xcli directory found. Let's set one up.</Text>
      </Box>

      {phase === "choose-location" && (
        <SelectionView
          question="Where should xcli actions live?"
          options={locationOptions.map((o) => o.label)}
          selectedIndex={selectedIndex}
        />
      )}

      {phase === "choose-repo-setup" && (
        <SelectionView
          question="Shared repo setup"
          options={repoSetupOptions.map((o) => o.label)}
          selectedIndex={selectedIndex}
          hint="↑↓/jk navigate  enter select  esc back"
        />
      )}

      {phase === "fetching-orgs" && (
        <Box>
          <Text>
            <Spinner type="dots" /> Fetching GitHub orgs...
          </Text>
        </Box>
      )}

      {phase === "choose-org" && (
        <SelectionView
          question="Where should the repo be created?"
          options={orgOptions.map((o) => o.label)}
          selectedIndex={selectedIndex}
          hint="↑↓/jk navigate  enter select  esc back"
        />
      )}

      {phase === "creating-repo" && orgName && (
        <Box>
          <Text>
            <Spinner type="dots" /> Creating {orgName}/xcli-actions on GitHub...
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
            <Text dimColor>↑↓/jk navigate enter select</Text>
          </Box>
        </Box>
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

      {phase === "choose-push-strategy" && (
        <SelectionView
          question="How should changes be pushed?"
          options={pushStrategyOptions.map((o) => o.label)}
          selectedIndex={selectedIndex}
          hint="↑↓/jk navigate  enter select  esc back"
        />
      )}

      {phase === "fetching-members" && (
        <Box>
          <Text>
            <Spinner type="dots" /> Fetching team members...
          </Text>
        </Box>
      )}

      {phase === "choose-reviewer" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>? Who should review PRs?</Text>
          </Box>
          {reviewerSearch && (
            <Box marginBottom={1}>
              <Text dimColor>filter: </Text>
              <Text>{reviewerSearch}</Text>
            </Box>
          )}
          {filteredReviewerOptions.map((opt, i) => {
            const checked = selectedReviewersRef.current.has(opt.value);
            const prefix = i === selectedIndex ? "❯ " : "  ";
            const checkbox = checked ? "[x]" : "[ ]";
            const teamTag = opt.type === "team" ? " (team)" : "";
            const nameSuffix = opt.displayName ? ` (${opt.displayName})` : "";
            return (
              <Box key={opt.value}>
                <Text color={i === selectedIndex ? "cyan" : undefined}>
                  {prefix}
                  {checkbox} {opt.label}
                  {teamTag}
                </Text>
                {nameSuffix && <Text dimColor>{nameSuffix}</Text>}
              </Box>
            );
          })}
          <Text
            color={
              selectedIndex === filteredReviewerOptions.length
                ? "cyan"
                : undefined
            }
          >
            {selectedIndex === filteredReviewerOptions.length ? "❯ " : "  "}
            Done ({selectedReviewersRef.current.size} selected)
          </Text>
          <Box marginTop={1}>
            <Text dimColor>
              space/enter toggle ↑↓/jk navigate tab confirm esc back
            </Text>
          </Box>
        </Box>
      )}

      {phase === "enter-reviewer" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>
              ? Who should review PRs? (comma-separated, blank for none)
            </Text>
          </Box>
          <Box>
            <Text>
              {"  "}
              {">"} {reviewerInput}
            </Text>
            <Text dimColor>█</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>enter submit esc back</Text>
          </Box>
        </Box>
      )}

      {phase === "choose-ai" && (
        <SelectionView
          question="Enable AI action generation?"
          options={aiOptions.map((o) => o.label)}
          selectedIndex={selectedIndex}
          hint="↑↓/jk navigate  enter select  esc back"
        />
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
          branchProtectionWarning={branchProtectionWarning}
        />
      )}
    </Box>
  );
}

// ─── Sub-views ───

function SelectionView({
  question,
  options,
  selectedIndex,
  hint = "↑↓/jk navigate  enter select",
}: {
  question: string;
  options: string[];
  selectedIndex: number;
  hint?: string;
}) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>? {question}</Text>
      </Box>
      {options.map((label, i) => (
        <Text key={label} color={i === selectedIndex ? "cyan" : undefined}>
          {i === selectedIndex ? "❯ " : "  "}
          {label}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>{hint}</Text>
      </Box>
    </Box>
  );
}

function DoneView({
  aiEnabled,
  sampleCreated,
  branchProtectionWarning,
}: {
  aiEnabled: boolean;
  sampleCreated: boolean;
  branchProtectionWarning: string | null;
}) {
  return (
    <Box flexDirection="column">
      {aiEnabled && (
        <Box marginBottom={1}>
          <Text color="green">✓ AI generation enabled</Text>
        </Box>
      )}
      {branchProtectionWarning && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ {branchProtectionWarning}</Text>
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
