# Plugins — Implementation Plan

## Context

kadai currently discovers actions exclusively from the local `.kadai/actions/` directory. This plan adds a plugin system that lets users pull actions from external sources — npm packages and GitHub repos — configured in `.kadai/config.ts`. Plugins appear as top-level directories in the menu with a distinct marker showing they're externally sourced.

The end goal: create a shared actions repo (e.g. `@zdavison/claude-tools`), publish it to npm or host it on GitHub, and have it show up in any project's kadai menu by adding one line to config.

### Prior Art

`docs/plans/sharing.md` explored GitHub-only external sources for the old `zcli` project. This plan supersedes it with a more general plugin abstraction supporting multiple source types.

---

## Design

### Config Format

Users add a `plugins` array to `.kadai/config.ts`:

```ts
export default {
  plugins: [
    // npm — version pinning via semver
    { npm: "@zdavison/claude-tools" },
    { npm: "@zdavison/claude-tools", version: "^1.2.0" },
    { npm: "kadai-devops-scripts", version: "1.0.0" },

    // GitHub — ref pinning via branch/tag/commit
    { github: "zdavison/kadai-shared", ref: "main" },
    { github: "myorg/ops-scripts", ref: "v2.1.0" },
  ],
};
```

Both `version` and `ref` are optional — npm defaults to `latest`, GitHub defaults to `main`.

#### Local path plugins

Local paths are supported for monorepos, shared local directories, and the user-global plugin:

```ts
export default {
  plugins: [
    { path: "../shared-scripts" },     // relative to .kadai/
    { path: "/opt/company/kadai-ops" }, // absolute path
  ],
};
```

Local path plugins are never fetched or cached — the loader reads directly from the path. They appear in the menu like any other plugin with `📦`.

#### User-global actions (`~/.kadai/actions`)

kadai automatically loads `~/.kadai/actions/` as a built-in plugin — no config needed. This gives users a place to put personal actions that work across all projects. These appear in the menu as:

```
📦 ~ ▸
```

The user-global plugin:
- Loads from `~/.kadai/actions/` (hardcoded, not configurable)
- Always present if the directory exists, even without any config
- Sorted first among plugins (before npm/github plugins) since it's the most personal/global
- Is never fetched/synced — it's a local path, just in the home directory
- Has `origin: { type: "plugin", pluginName: "~" }`

### Plugin Structure

A plugin is any directory containing an `actions/` folder at its root. This is the same structure as `.kadai/` itself, minus the config:

```
my-plugin/
├── package.json          # Dependencies declared here
├── actions/
│   ├── deploy.sh
│   ├── database/
│   │   ├── reset.ts      # Can import from package.json dependencies
│   │   └── migrate.ts
│   └── monitoring/
│       └── check-health.py
└── node_modules/         # Installed by kadai during sync
```

For npm packages, the `actions/` directory is discovered from the installed package root. For GitHub repos, it's discovered from the repo root.

### Plugin Dependencies

Plugins can declare dependencies in a `package.json` at the plugin root. After fetching a plugin into the cache, kadai checks for `package.json` and runs `<pm> install` if present. The resulting `node_modules/` lives inside the cached plugin directory — module resolution walks up from the action script's location and finds it naturally.

#### Package Manager Resolution

kadai can't assume Bun is available — users may run kadai via `npx`. The package manager used for `install` is resolved with a three-tier strategy, following the same pattern as `runner.ts`'s runtime chains:

**1. Respect `packageManager` field** — If the plugin's `package.json` declares `"packageManager": "pnpm@9.1.0"` (the [corepack convention](https://nodejs.org/api/corepack.html)), use that.

**2. Availability chain** — If no `packageManager` field, try in priority order (mirrors the `node` runtime chain in `runner.ts`):

| Priority | Binary | Install command |
| :------- | :----- | :-------------- |
| 1        | `bun`  | `bun install`   |
| 2        | `npm`  | `npm install`   |

Resolution uses `cachedWhich()` — first binary found on PATH wins.

**3. Error** — If none are found, the plugin sync fails for that plugin with a clear error message.

This is implemented as a shared utility in `src/core/pm.ts` so it can be reused by the fetcher pipeline and potentially by `runner.ts` in the future.

#### Install Pipeline

Dependency install is part of the sync pipeline:

```
fetch plugin → extract to cache → <pm> install (if package.json exists) → write .plugin-meta.json
```

The install step only runs when the plugin is first fetched or when an update is detected. Subsequent kadai startups skip it (cache already has `node_modules/`).

For **path plugins** and **user-global** (`~/.kadai/actions`), dependency management is the author's responsibility — kadai does not run install in directories it doesn't own.

### Cache Layout

```
.kadai/
├── .cache/
│   ├── .gitignore              # Contains "*"
│   └── plugins/
│       ├── npm/
│       │   └── @zdavison--claude-tools@1.2.0/
│       │       ├── .plugin-meta.json
│       │       ├── package.json
│       │       ├── node_modules/    # Installed by kadai if package.json exists
│       │       └── actions/
│       └── github/
│           └── zdavison--kadai-shared@main/
│               ├── .plugin-meta.json
│               ├── package.json
│               ├── node_modules/
│               └── actions/
```

Cache key format: `{name-with-dashes}@{version-or-ref}`. Scoped npm names use `--` in place of `/`.

`.plugin-meta.json`:
```json
{
  "fetchedAt": "2026-02-27T10:00:00Z",
  "source": { "npm": "@zdavison/claude-tools", "version": "1.2.0" },
  "resolvedVersion": "1.2.0"
}
```

### Menu Display

Plugins appear as top-level category folders with a `📦` emoji prefix to distinguish them from local directories.

Menu items are sorted most-global to most-local:

```
kadai
❯ 📦 @zdavison/claude-tools ▸      ← plugins (most global)
  📦 kadai-devops-scripts ▸
  📁 database ▸                     ← local categories
  📁 monitoring ▸
  🚀 Deploy                         ← local actions (most local)
```

Inside a plugin directory, actions display normally — their own emojis, descriptions, subcategories all work as expected. The `📦` only appears on the top-level plugin folder entry.

Sort order within `buildMenuItems`:
1. Plugin directories (alphabetical)
2. Local categories (alphabetical)
3. Local actions (alphabetical)

### Fetch Strategy — Non-Blocking Background Sync

The menu must never be blocked by network requests. Loading flow:

```
1. loadConfig()
2. loadActions(localActionsDir)          → render menu immediately
3. loadCachedPlugins(kadaiDir, plugins)  → merge cached plugin actions into menu
4. syncPlugins(kadaiDir, plugins, onUpdate) → background fetch (per-plugin)
     ├─ on success: onUpdate(freshActions) → re-render menu with new data
     └─ on failure: keep stale cache, log warning
```

Steps 2 and 3 are near-instant (disk reads). Step 4 runs in the background and calls `onUpdate` per-plugin as each one resolves.

#### Per-Plugin Sync Indicator

Each plugin tracks its own sync state. While a plugin is still resolving/fetching, its menu entry shows a spinner:

```
kadai
❯ 📦 @zdavison/claude-tools ⟳       ← still syncing
  📦 kadai-devops-scripts ✓          ← up to date
  📁 database ▸
```

The `syncPlugins` function reports progress per-plugin via a callback:

```ts
type PluginSyncStatus = "syncing" | "done" | "error";

syncPlugins(kadaiDir, plugins, {
  onPluginStatus: (pluginName: string, status: PluginSyncStatus) => void;
  onUpdate: (actions: Action[]) => void;
});
```

The `⟳` spinner appears inline next to the plugin name in the menu. Once sync completes (success or failure), it disappears. No global status bar indicator needed — the per-plugin markers are sufficient.

### Version Resolution

**npm plugins:**
- Use `bun install --no-save` into a temp directory to resolve versions, then copy `actions/` into cache
- Alternatively, use the npm registry API to resolve the tarball URL and extract directly
- The resolved exact version is stored in `.plugin-meta.json` so we can skip re-fetching if nothing changed

**GitHub plugins:**
- `git clone --depth 1 --branch {ref}` into a temp directory, then copy `actions/` into cache
- Store the commit SHA in `.plugin-meta.json` for change detection

### Staleness & Re-sync

On every kadai startup:
1. Load from cache (instant)
2. Background check each plugin for updates:
   - **npm**: Compare `resolvedVersion` in meta against latest matching version from registry
   - **github**: Compare stored SHA against remote HEAD of the ref
3. Only re-download if changed

A manual `kadai sync` command forces a full re-fetch of all plugins regardless of staleness.

---

## Types

### New Types

```ts
/** npm plugin source */
interface NpmPluginSource {
  npm: string;
  /** @default "latest" */
  version?: string;
}

/** GitHub plugin source */
interface GithubPluginSource {
  github: string;
  /** @default "main" */
  ref?: string;
}

/** Local path plugin source */
interface PathPluginSource {
  path: string;
}

type PluginSource = NpmPluginSource | GithubPluginSource | PathPluginSource;

/** Metadata stored alongside cached plugin actions (not used for path plugins) */
interface PluginMeta {
  fetchedAt: string;
  source: NpmPluginSource | GithubPluginSource;
  /** Exact resolved version (npm) or commit SHA (github) */
  resolvedVersion: string;
}

/** Identifies where an action came from */
interface ActionOrigin {
  type: "local" | "plugin";
  /** Display label, e.g. "@zdavison/claude-tools", "~", or "../shared" */
  pluginName?: string;
}

/** Per-plugin sync progress */
type PluginSyncStatus = "syncing" | "done" | "error";
```

### Modified Types

```ts
// KadaiConfig — add plugins field
interface KadaiConfig {
  actionsDir?: string;
  env?: Record<string, string>;
  plugins?: PluginSource[];
}

// Action — add origin field
interface Action {
  // ... existing fields
  origin: ActionOrigin;
}

// MenuItem — add origin marker
interface MenuItem {
  // ... existing fields
  isPlugin?: boolean;
}
```

---

## Files to Create

### `src/core/pm.ts` — Package manager resolution

Shared utility for resolving which package manager to use. Follows the same chain pattern as `runner.ts`:

```ts
interface ResolvedPM {
  bin: string;           // e.g. "bun", "npm"
  install: string[];     // e.g. ["bun", "install"]
}

/**
 * Resolve the package manager to use for a given directory.
 * 1. Check package.json `packageManager` field (corepack convention)
 * 2. Try availability chain: bun → npm (matches runner.ts node chain)
 * 3. Throw if none found
 */
function resolvePM(dir: string): Promise<ResolvedPM>;
```

Uses `cachedWhich()` for binary detection — extract from `runner.ts` into a shared util so both modules can use it. `cachedWhich` wraps `Bun.which()` with a `Map` cache to avoid repeated PATH lookups.

### `src/core/plugins.ts` — Plugin orchestration

Responsibilities:
- `loadCachedPlugins(kadaiDir, plugins)` — scan `.kadai/.cache/plugins/` for cached actions, return `Action[]`
- `syncPlugins(kadaiDir, plugins, callbacks)` — background sync all plugins, report per-plugin status
- `syncPlugin(kadaiDir, plugin)` — fetch → install deps → write meta for a single plugin
- `installPluginDeps(pluginDir)` — resolve PM via `resolvePM()`, run `<pm> install` if `package.json` exists
- `ensurePluginCacheDir(kadaiDir)` — create `.cache/plugins/` and `.gitignore` if missing
- `cacheKeyFor(plugin)` — deterministic cache directory name from plugin source
- `readPluginMeta(cacheDir)` / `writePluginMeta(cacheDir, meta)` — read/write `.plugin-meta.json`

### `src/core/fetchers/npm.ts` — npm fetcher

Responsibilities:
- `fetchNpmPlugin(source, destDir)` — resolve version, download tarball, extract `actions/` into `destDir`
- `checkNpmUpdate(source, currentVersion)` — check if a newer matching version exists without downloading
- Uses the npm registry HTTP API (`https://registry.npmjs.org/{package}`) to resolve versions and download tarballs directly — avoids depending on any specific package manager for the fetch itself

### `src/core/fetchers/github.ts` — GitHub fetcher

Responsibilities:
- `fetchGithubPlugin(source, destDir)` — shallow clone, copy `actions/` into `destDir`
- `checkGithubUpdate(source, currentSha)` — compare remote HEAD SHA against cached SHA
- Uses `git clone --depth 1 --branch {ref}` via `Bun.spawn`

### `src/core/fetchers/types.ts` — Shared fetcher interface

```ts
export interface PluginFetcher<T extends PluginSource> {
  fetch(source: T, destDir: string): Promise<{ resolvedVersion: string }>;
  checkForUpdate(source: T, currentVersion: string): Promise<boolean>;
}
```

---

## Files to Modify

### `src/types.ts`

- Add `PluginSource`, `NpmPluginSource`, `GithubPluginSource`, `PathPluginSource`, `PluginMeta`, `ActionOrigin`, `PluginSyncStatus` types
- Add `plugins?: PluginSource[]` to `KadaiConfig`
- Add `origin: ActionOrigin` to `Action`
- Add `isPlugin?: boolean` to `MenuItem`

### `src/core/config.ts`

- Pass through `plugins` array from user config (no transformation needed, just include in return value)

### `src/core/loader.ts`

- `loadActions` gains an optional `origin?: ActionOrigin` parameter
- All loaded actions get tagged with `origin` (defaults to `{ type: "local" }`)
- Plugin actions use the plugin name as a top-level category prefix so they appear grouped

### `src/hooks/useActions.ts`

- After loading local actions:
  1. Load user-global actions from `~/.kadai/actions/` (if dir exists)
  2. Load path plugin actions (direct disk read, no cache)
  3. Load cached npm/github plugin actions from `.kadai/.cache/plugins/`
  4. Merge all into state → menu renders
  5. Kick off `syncPlugins()` for npm/github plugins with per-plugin status callbacks
- Track `pluginSyncStatuses: Map<string, PluginSyncStatus>` for per-plugin spinners

### `src/app.tsx`

- `buildMenuItems` updated to:
  - Render plugin top-level folders with `📦` instead of `📁`
  - Sort order: plugin directories → local categories → local actions
  - Plugin entries include per-plugin sync status indicator (`⟳` while syncing)
- Pass `pluginSyncStatuses` map down for rendering

### `src/core/args.ts`

- Add `kadai sync` command parsing

### `src/core/commands.ts`

- Add `handleSync()` command that force-refreshes all plugins and prints results

---

## Implementation Order (TDD)

### Step 1: Types & Config

**Tests first** (`test/config.test.ts` — extend existing):
- Config with `plugins: [{ npm: "foo" }]` loads correctly
- Config with `plugins: [{ github: "org/repo" }]` loads correctly
- Config with no plugins returns `plugins: undefined`
- Mixed npm + github plugins parse correctly

**Implement:**
- Add new types to `src/types.ts`
- Update `src/core/config.ts` to include `plugins` in return value
- Add `origin: { type: "local" }` to all existing action construction in `loader.ts`

**Create fixture:** `test/fixtures/plugin-repo/` with a `.kadai/config.ts` that includes plugins

### Step 2: Package manager resolution

**Tests first** (`test/pm.test.ts`):
- `resolvePM` reads `packageManager` field from `package.json` and uses it (e.g. `"pnpm@9.1.0"` → `pnpm`)
- `resolvePM` ignores `packageManager` if the declared binary isn't on PATH (falls through to chain)
- `resolvePM` walks availability chain: bun → npm (mirrors runner.ts node chain)
- `resolvePM` throws when no package manager is available
- `resolvePM` returns correct install command for each PM

**Implement:** `src/core/pm.ts`

### Step 3: Cache infrastructure

**Tests first** (`test/plugins.test.ts`):
- `ensurePluginCacheDir` creates `.cache/plugins/` and `.gitignore`
- `cacheKeyFor({ npm: "@zdavison/claude-tools", version: "1.2.0" })` → `"npm/@zdavison--claude-tools@1.2.0"`
- `cacheKeyFor({ github: "zdavison/shared", ref: "main" })` → `"github/zdavison--shared@main"`
- `readPluginMeta` / `writePluginMeta` round-trip correctly
- `readPluginMeta` returns null for missing cache

**Implement:** `src/core/plugins.ts` (cache utilities only)

### Step 4: Fetcher — npm

**Tests first** (`test/fetchers/npm.test.ts`):
- `fetchNpmPlugin` downloads and extracts a package's `actions/` directory
- Resolved version is returned and matches expected semver
- Missing `actions/` directory in package errors gracefully
- `checkNpmUpdate` returns `true` when newer version available
- `checkNpmUpdate` returns `false` when version unchanged

**Implement:** `src/core/fetchers/npm.ts`

Note: For unit tests, mock the HTTP calls to npm registry. Integration test can use a real tiny test package.

### Step 5: Fetcher — GitHub

**Tests first** (`test/fetchers/github.test.ts`):
- `fetchGithubPlugin` clones repo and extracts `actions/`
- Resolved version (commit SHA) is returned
- Invalid repo errors gracefully
- `checkGithubUpdate` detects changed refs

**Implement:** `src/core/fetchers/github.ts`

Note: Mock `Bun.spawn` for git commands in unit tests.

### Step 6: Plugin loading from cache

**Tests first** (`test/plugins.test.ts` — extend):
- `loadCachedPlugins` returns `[]` when no cache exists
- `loadCachedPlugins` returns actions from pre-populated cache fixture
- Actions have correct `origin` field: `{ type: "plugin", pluginName: "@zdavison/claude-tools" }`
- Actions have correct category prefix so they group under the plugin name
- Actions from multiple plugins don't collide

**Implement:** `loadCachedPlugins` in `src/core/plugins.ts`

**Create fixture:** `test/fixtures/cached-plugins/` with pre-built cache structure containing action files

### Step 7: Background sync orchestration

**Tests first** (`test/plugins.test.ts` — extend):
- `syncPlugins` calls `onUpdate` with refreshed actions on success
- `syncPlugins` keeps stale cache on fetch failure
- `syncPlugins` skips download when `checkForUpdate` returns false
- Multiple plugins sync concurrently (Promise.allSettled)
- `syncPlugins` reports per-plugin status via `onPluginStatus` callback
- `installPluginDeps` calls `resolvePM()` and runs the resolved install command
- `installPluginDeps` respects `packageManager` field in plugin's `package.json`
- `installPluginDeps` is a no-op when no `package.json` present
- Sync pipeline: fetch → install deps → write meta (in order)

**Implement:** `syncPlugins`, `syncPlugin`, and `installPluginDeps` in `src/core/plugins.ts`

### Step 8: Path plugins & user-global

**Tests first** (`test/plugins.test.ts` — extend):
- Path plugin loads actions directly from the resolved path
- Path plugin actions have correct `origin: { type: "plugin", pluginName: "../shared" }`
- Relative paths resolve relative to `.kadai/` directory
- Missing path plugin directory handled gracefully (skip, no error)
- User-global `~/.kadai/actions/` loaded when directory exists
- User-global skipped when `~/.kadai/actions/` doesn't exist
- User-global actions have `origin: { type: "plugin", pluginName: "~" }`

**Implement:**
- Add path plugin loading to `src/core/plugins.ts`
- Add user-global detection to `src/hooks/useActions.ts`

### Step 9: Hook & UI integration

**Tests first:**
- `test/app.test.ts` — extend: plugin actions appear in menu with `📦` marker
- `test/build-menu.test.ts` — extend: `buildMenuItems` sorts plugins before local items (global → local order)
- `test/build-menu.test.ts` — extend: user-global `~` plugin sorts first among plugins
- `test/useActions.test.ts` (new or extend): hook merges local + path + cached plugin actions
- Per-plugin sync indicator shows `⟳` for syncing plugins

**Implement:**
- Update `src/hooks/useActions.ts` — load all plugin types, start background sync with per-plugin callbacks
- Update `src/app.tsx` — `buildMenuItems` handles plugin categories with `📦`, sort order, sync indicators

### Step 10: `kadai sync` command

**Tests first** (`test/commands.test.ts` — extend):
- `kadai sync` triggers full re-fetch of all configured plugins
- Prints summary of updated/unchanged/failed plugins

**Implement:**
- Add `sync` to `src/core/args.ts`
- Add `handleSync()` to `src/core/commands.ts`

### Step 11: Polish

- Error handling for network failures, invalid packages, permission errors
- Timeout on sync operations (don't hang the background forever)
- Ensure `.cache/` is properly gitignored
- MCP integration: plugin actions exposed as MCP tools alongside local ones
- `kadai list --json` includes plugin actions with `origin` field

---

## Open Questions

| Question                                                    | Lean                                                                                    |
| :---------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| Should plugins be able to provide their own `env` vars?     | No — keep it simple. All env comes from local config.                                   |
| Should `kadai sync` have a `--plugin` flag to sync one?     | Nice to have, not in v1.                                                                |
| How to handle plugin name collisions?                       | Error at config load time if two plugins resolve to the same display name.              |
| Should plugins support `.tsx` ink actions?                   | Yes — they go through the same loader. But the plugin must bundle its own dependencies. |
| Auth for private GitHub repos / private npm packages?       | Use ambient auth (git credential helper, `.npmrc`). No special kadai auth config.       |

---

## Verification

1. Publish a test npm package with `actions/hello.sh` containing a simple script
2. Add `{ npm: "kadai-test-plugin" }` to `.kadai/config.ts`
3. Run `bun src/cli.tsx` — local actions appear instantly
4. After a moment, `📦 kadai-test-plugin` appears in the menu
5. Navigate into it, run `hello.sh` — works
6. Kill network, restart — cached plugin still appears
7. Run `bun src/cli.tsx sync` — force re-fetch prints summary
8. Add a GitHub source, verify same behavior
9. Pin an npm version, verify it doesn't auto-update past that pin
10. `bun test` — all tests pass
