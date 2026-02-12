export interface ActionMeta {
  /** Display name shown in menus */
  name: string;
  /** Emoji displayed before the name in menus */
  emoji?: string;
  /** Short description shown alongside the name */
  description?: string;
  /**
   * Require user confirmation before running
   * @default false
   */
  confirm?: boolean;
  /**
   * Hide from menu (still searchable)
   * @default false
   */
  hidden?: boolean;
}

export interface Action {
  /**
   * Unique path-based ID
   * @example "database/reset"
   */
  id: string;
  /** Parsed metadata from frontmatter, exports, or filename inference */
  meta: ActionMeta;
  /** Absolute path to the script file */
  filePath: string;
  /**
   * Category hierarchy derived from directory path
   * @example ["database"]
   * @example []
   */
  category: string[];
  /** How to execute the script, determined by file extension */
  runtime: Runtime;
  /**
   * Parsed shebang line from the script, if present
   * @example "#!/usr/bin/env zsh"
   */
  shebang?: string;
  /** Where this action was loaded from */
  source?: ActionSource;
}

/**
 * Execution strategy mapped from file extension
 * @example ".ts" → "bun"
 * @example ".sh" → "bash"
 * @example ".py" → "python"
 */
export type Runtime = "bun" | "node" | "bash" | "python" | "executable";

export interface ActionContext {
  /** Run a shell command and capture its output */
  exec: (cmd: string) => Promise<ExecResult>;
  /** Working directory for the action */
  cwd: string;
  /** Root directory of the repository */
  repoRoot: string;
}

export interface ExecResult {
  /**
   * Process exit code
   * @example 0
   */
  exitCode: number;
  /** Captured standard output */
  stdout: string;
  /** Captured standard error */
  stderr: string;
}

export interface MenuItem {
  /** Whether this item represents an action or a navigable category */
  type: "action" | "category";
  /** Display text for the menu item */
  label: string;
  /** Emoji prefix for action items */
  emoji?: string;
  /** Description shown alongside the label */
  description?: string;
  /** Action ID or category name used for selection */
  value: string;
  /** Dimmed source label for external actions */
  source?: string;
}

export interface NavigationState {
  /** Stack of screens; the last element is the current view */
  stack: Screen[];
}

export type Screen =
  /** Menu listing actions/categories at a given path */
  | { type: "menu"; path: string[] }
  /** Output display for a running or completed action */
  | { type: "output"; actionId: string }
  /** Confirmation prompt before running an action */
  | { type: "confirm"; actionId: string };

export interface SourceConfig {
  /** GitHub repo in "org/repo-name" format */
  repo: string;
  /**
   * Git ref to fetch
   * @default "main"
   */
  ref?: string;
}

export interface ActionSource {
  /** Where this action was loaded from */
  type: "local" | "github";
  /**
   * Display label for the source
   * @example "meetsmore/xcli-scripts" or "local"
   */
  label: string;
}

export interface SourceMeta {
  /** ISO timestamp of when this source was last fetched */
  fetchedAt: string;
  /** GitHub repo in "org/repo-name" format */
  repo: string;
  /** Git ref that was fetched */
  ref: string;
}

export interface XcliConfig {
  /**
   * Subdirectory name under `.xcli/` containing actions
   * @default "actions"
   */
  actionsDir?: string;
  /** Environment variables injected into all action processes */
  env?: Record<string, string>;
  /** Lifecycle hooks run before/after every action */
  hooks?: {
    /** Shell command run before any action executes */
    before?: string;
    /** Shell command run after any action completes */
    after?: string;
  };
  /** External GitHub repos to load actions from */
  sources?: SourceConfig[];
}
