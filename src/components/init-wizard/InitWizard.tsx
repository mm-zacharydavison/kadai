import { Spinner } from "@inkjs/ui";
import { Box, Text } from "ink";
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
} from "../../core/init-wizard.ts";
import type { ShareConfig, SourceConfig } from "../../types.ts";
import { ChooseAiPhase } from "./ChooseAiPhase.tsx";
import { ChooseLocationPhase } from "./ChooseLocationPhase.tsx";
import { ChooseOrgPhase } from "./ChooseOrgPhase.tsx";
import { ChoosePushStrategyPhase } from "./ChoosePushStrategyPhase.tsx";
import { ChooseRepoSetupPhase } from "./ChooseRepoSetupPhase.tsx";
import { ChooseReviewerPhase } from "./ChooseReviewerPhase.tsx";
import { CreateFailedPhase } from "./CreateFailedPhase.tsx";
import { DoneView } from "./DoneView.tsx";
import { EnterRepoPhase } from "./EnterRepoPhase.tsx";
import { EnterReviewerPhase } from "./EnterReviewerPhase.tsx";

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

  // Collected answers
  const sourcesRef = useRef<SourceConfig[]>([]);
  const shareConfigRef = useRef<ShareConfig | undefined>(undefined);
  const [aiEnabled, setAiEnabled] = useState(false);
  const aiEnabledRef = useRef(false);
  const [orgName, setOrgName] = useState<string | undefined>(undefined);
  const orgNameRef = useRef<string | undefined>(undefined);
  const orgsRef = useRef<OrgInfo[]>([]);
  const ghUsernameRef = useRef<string | null>(null);

  const reviewerOptionsRef = useRef<ReviewerOption[]>([]);
  const [reviewerOptions, setReviewerOptions] = useState<ReviewerOption[]>([]);

  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoValidating, setRepoValidating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [branchProtectionWarning, setBranchProtectionWarning] = useState<
    string | null
  >(null);
  const [writeResult, setWriteResult] = useState<{
    sampleCreated: boolean;
  } | null>(null);

  const updatePhase = (p: Phase) => {
    setPhase(p);
  };
  const updateSources = (s: SourceConfig[]) => {
    sourcesRef.current = s;
  };
  const updateShareConfig = (s: ShareConfig | undefined) => {
    shareConfigRef.current = s;
  };
  const updateOrgName = (v: string | undefined) => {
    orgNameRef.current = v;
    setOrgName(v);
  };
  const updateReviewerOptions = (opts: ReviewerOption[]) => {
    reviewerOptionsRef.current = opts;
    setReviewerOptions(opts);
  };

  // ─── Selection handlers ───

  function onLocationSelect(value: string) {
    if (value === "local") {
      updateSources([]);
      updatePhase("choose-push-strategy");
    } else {
      updatePhase("choose-repo-setup");
    }
  }

  function onRepoSetupSelect(value: string) {
    if (value === "create") {
      updatePhase("fetching-orgs");
      Promise.all([fetchOrgs(deps), fetchGitHubUsername(deps)]).then(
        ([orgList, username]) => {
          orgsRef.current = orgList;
          ghUsernameRef.current = username;
          updatePhase("choose-org");
        },
      );
    } else {
      setRepoError(null);
      updatePhase("enter-repo");
    }
  }

  function onOrgSelect(owner: string) {
    updateOrgName(owner);
    updatePhase("creating-repo");
    createXcliActionsRepo(owner, deps).then((result) => {
      if (result.success) {
        const src: SourceConfig = { repo: result.repo };
        if (result.defaultBranch !== "main") {
          src.ref = result.defaultBranch;
        }
        updateSources([src]);
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
        updatePhase("create-failed");
      }
    });
  }

  function onCreateFailedSelect(value: string) {
    if (value === "different-repo") {
      setRepoError(null);
      updatePhase("enter-repo");
    } else {
      updateSources([]);
      updatePhase("choose-push-strategy");
    }
  }

  function onPushStrategySelect(value: string) {
    if (value === "push") {
      updateShareConfig(undefined);
      updatePhase("choose-ai");
    } else if (value === "branch") {
      updateShareConfig({ strategy: "branch" });
      updatePhase("choose-ai");
    } else if (value === "pr") {
      updateShareConfig({ strategy: "pr" });
      startFetchingMembers();
    }
  }

  function onAiSelect(value: string) {
    const enabled = value === "yes";
    aiEnabledRef.current = enabled;
    setAiEnabled(enabled);

    if (enabled) {
      detectAiCli(deps).then(() => {
        startWriting();
      });
    } else {
      startWriting();
    }
  }

  function onRepoSubmit(value: string) {
    const repo = value.trim();
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
        const [repoOrg] = repo.split("/");
        if (repoOrg) updateOrgName(repoOrg);
        updatePhase("choose-push-strategy");
      } else {
        setRepoError(`Could not find "${repo}" on GitHub.`);
      }
    });
  }

  function onReviewerSubmit(values: string[]) {
    if (values.length > 0) {
      updateShareConfig({
        ...shareConfigRef.current,
        strategy: "pr",
        reviewers: values,
      });
    }
    updatePhase("choose-ai");
  }

  function onEnterReviewerSubmit(value: string) {
    const raw = value.trim();
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
    updatePhase("choose-ai");
  }

  function fetchReviewersFromRepo(repo: string) {
    fetchReviewerOptions(repo, deps).then((options) => {
      if (options.length > 0) {
        updateReviewerOptions(options);
        updatePhase("choose-reviewer");
      } else {
        updatePhase("enter-reviewer");
      }
    });
  }

  function startFetchingMembers() {
    updatePhase("fetching-members");

    const sourceRepo = sourcesRef.current[0]?.repo;
    if (sourceRepo) {
      fetchReviewersFromRepo(sourceRepo);
      return;
    }

    deps.detectRepo(cwd).then((identity) => {
      if (identity) {
        fetchReviewersFromRepo(`${identity.org}/${identity.repo}`);
      } else {
        updatePhase("enter-reviewer");
      }
    });
  }

  function startWriting() {
    updatePhase("writing");

    const sources = sourcesRef.current;
    const share = shareConfigRef.current;
    const org = orgNameRef.current;

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

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}>
        <Text>No .xcli directory found. Let's set one up.</Text>
      </Box>

      {phase === "choose-location" && (
        <ChooseLocationPhase onSelect={onLocationSelect} />
      )}
      {phase === "choose-repo-setup" && (
        <ChooseRepoSetupPhase
          onSelect={onRepoSetupSelect}
          onEscape={() => updatePhase("choose-location")}
        />
      )}
      {phase === "fetching-orgs" && <Spinner label="Fetching GitHub orgs..." />}
      {phase === "choose-org" && (
        <ChooseOrgPhase
          orgs={orgsRef.current}
          ghUsername={ghUsernameRef.current}
          onSelect={onOrgSelect}
          onEscape={() => updatePhase("choose-repo-setup")}
        />
      )}
      {phase === "creating-repo" && orgName && (
        <Spinner label={`Creating ${orgName}/xcli-actions on GitHub...`} />
      )}
      {phase === "create-failed" && (
        <CreateFailedPhase
          error={createError}
          onSelect={onCreateFailedSelect}
          onEscape={() => updatePhase("choose-repo-setup")}
        />
      )}
      {phase === "enter-repo" && (
        <EnterRepoPhase
          validating={repoValidating}
          error={repoError}
          onSubmit={onRepoSubmit}
          onEscape={() => {
            setRepoError(null);
            updatePhase("choose-repo-setup");
          }}
        />
      )}
      {phase === "choose-push-strategy" && (
        <ChoosePushStrategyPhase
          onSelect={onPushStrategySelect}
          onEscape={() => {
            if (sourcesRef.current.length > 0) {
              updatePhase("choose-repo-setup");
            } else {
              updatePhase("choose-location");
            }
          }}
        />
      )}
      {phase === "fetching-members" && (
        <Spinner label="Fetching team members..." />
      )}
      {phase === "choose-reviewer" && (
        <ChooseReviewerPhase
          reviewerOptions={reviewerOptions}
          onSubmit={onReviewerSubmit}
          onEscape={() => updatePhase("choose-push-strategy")}
        />
      )}
      {phase === "enter-reviewer" && (
        <EnterReviewerPhase
          onSubmit={onEnterReviewerSubmit}
          onEscape={() => updatePhase("choose-push-strategy")}
        />
      )}
      {phase === "choose-ai" && (
        <ChooseAiPhase
          onSelect={onAiSelect}
          onEscape={() => updatePhase("choose-push-strategy")}
        />
      )}
      {phase === "writing" && <Spinner label="Writing files..." />}
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
