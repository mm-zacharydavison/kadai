export interface ActionInput {
  /** Variable name used for env var injection and .last-action storage */
  name: string;
  /** Value type — determines replay conversion and MCP schema type */
  type: "string" | "boolean" | "number";
  /** Whether the input must be provided (false when declared with '?') */
  required: boolean;
  /** Whether to skip saving this input to .last-action */
  sensitive?: boolean;
}

/** Collected input values keyed by input name */
export type InputValues = Record<string, string | boolean | number>;

/** JSON format stored in .last-action */
export interface LastActionRecord {
  actionId: string;
  inputs: InputValues;
}

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
  /**
   * Use alternate screen buffer when rendering (ink actions only)
   * @default false
   */
  fullscreen?: boolean;
  /**
   * Declared inputs recorded from stdin during run, replayed on --rerun.
   * Only used for naming inputs (for env var injection on replay) and marking sensitive ones.
   */
  inputs?: ActionInput[];
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
  /** Timestamp (ms) when this action file was created */
  addedAt?: number;
  /** Where this action came from (local .kadai/actions/ or a plugin) */
  origin: ActionOrigin;
}

/**
 * Execution strategy mapped from file extension
 * @example ".ts" → "bun"
 * @example ".sh" → "bash"
 * @example ".py" → "python"
 */
export type Runtime = "bun" | "node" | "bash" | "python" | "executable" | "ink";

export interface MenuItem {
  /** Whether this item represents an action, navigable category, or section separator */
  type: "action" | "category" | "separator";
  /** Display text for the menu item */
  label: string;
  /** Emoji prefix for action items */
  emoji?: string;
  /** Description shown alongside the label */
  description?: string;
  /** Action ID or category name used for selection */
  value: string;
  /** Whether this action was added within the past 7 days */
  isNew?: boolean;
  /** Whether this category represents a plugin (renders 📦 instead of 📁) */
  isPlugin?: boolean;
}

export type Screen =
  /** Menu listing actions/categories at a given path */
  | { type: "menu"; path: string[] }
  /** Confirmation prompt before running an action */
  | { type: "confirm"; actionId: string }
  /** In-process Ink component rendered within kadai */
  | { type: "ink-component"; actionId: string };

export interface InkActionProps {
  /** Working directory the action runs in */
  cwd: string;
  /** Environment variables from kadai config */
  env: Record<string, string>;
  /** Additional arguments passed to the action */
  args: string[];
  /** Call this to return to the kadai menu */
  onExit: () => void;
}

export interface KadaiConfig {
  /**
   * Subdirectory name under `.kadai/` containing actions
   * @default "actions"
   */
  actionsDir?: string;
  /** Environment variables injected into all action processes */
  env?: Record<string, string>;
  /** External plugin sources to load actions from */
  plugins?: PluginSource[];
}

// ─── Plugin types ────────────────────────────────────────────────

/** npm plugin source */
export interface NpmPluginSource {
  npm: string;
  /**
   * Semver version constraint
   * @default "latest"
   * @example "^1.2.0"
   */
  version?: string;
}

/** GitHub plugin source */
export interface GithubPluginSource {
  /**
   * GitHub repo in "owner/repo" format
   * @example "zdavison/kadai-shared"
   */
  github: string;
  /**
   * Branch, tag, or commit to pin to
   * @default "main"
   */
  ref?: string;
}

/** Local path plugin source */
export interface PathPluginSource {
  /**
   * Path to a directory containing an `actions/` folder.
   * Relative paths are resolved relative to the `.kadai/` directory.
   * @example "../shared-scripts"
   * @example "/opt/company/kadai-ops"
   */
  path: string;
}

export type PluginSource =
  | NpmPluginSource
  | GithubPluginSource
  | PathPluginSource;

/** Metadata stored alongside cached plugin actions (not used for path plugins) */
export interface PluginMeta {
  /** ISO timestamp when the plugin was last fetched */
  fetchedAt: string;
  /** The original source config that produced this cache entry */
  source: NpmPluginSource | GithubPluginSource;
  /**
   * Exact resolved version (npm semver) or commit SHA (github)
   * @example "1.2.0"
   * @example "a1b2c3d4e5f6"
   */
  resolvedVersion: string;
}

/** Identifies where an action came from */
export interface ActionOrigin {
  type: "local" | "plugin";
  /**
   * Display label for plugin actions
   * @example "@zdavison/claude-tools"
   * @example "~"
   * @example "../shared"
   */
  pluginName?: string;
}

/** Per-plugin sync progress */
export type PluginSyncStatus = "syncing" | "done" | "error";
