# External Sources (Goal 2) — Implementation Plan

## Context

xcli currently only discovers actions from the local `.xcli/actions/` directory. Teams want to share scripts across repos via a central GitHub repository. This plan adds support for configuring external GitHub repos as action sources, with caching for instant startup and background refresh.

The key UX insight: **local actions load instantly, cached external actions load instantly, and fresh external data fetches asynchronously in the background**. The menu updates live if the fetched data differs from cache.

Syncing indicator: The StatusBar shows a `⟳ Syncing sources...` message while any background refresh is in progress. Per-action indicators would be noisy — a single global indicator is sufficient since all sources refresh together. Once the refresh completes (success or failure), the indicator disappears.

---

## Design

### Config format

Users add a `sources` array to `.xcli/config.ts`:

```ts
export default {
  sources: [
    { repo: "meetsmore/xcli-scripts", ref: "main" },
    { repo: "myorg/shared-ops", ref: "v2" },
  ],
};
```

Only GitHub repos for now. `ref` defaults to `"main"` if omitted.

### Cache layout

```
.xcli/
├── .cache/
│   ├── .gitignore              # Contains "*"
│   └── sources/
│       └── meetsmore-xcli-scripts-main/
│           ├── .source-meta.json   # { fetchedAt: ISO string, repo, ref }
│           └── actions/            # Cloned action files
```

Cache directory is auto-created and gitignored.

### Fetch strategy — async background refresh

1. **Startup**: Load local actions + cached external actions from disk (synchronous, fast)
2. **Render immediately** with whatever is available
3. **Background**: For each source, `git clone --depth 1` into a temp dir, then swap into cache
4. **On completion**: If fetched data differs from cache, update action state → React re-renders menu
5. **On failure**: Keep using stale cache silently, log warning to stderr

### Org/repo scoping

Shared repos use `@org/repo` directory naming to scope actions:

```
shared-xcli-scripts/.xcli/actions/
├── general/                    # Available everywhere
├── @meetsmore/
│   ├── common/                 # All @meetsmore repos
│   ├── api-server/             # Only @meetsmore/api-server
│   └── web-app/                # Only @meetsmore/web-app
```

When xcli detects the current repo is `@meetsmore/api-server` (via git remote), it **auto-navigates** into the matching scoped directory. User can ESC back to browse everything. Nothing is filtered — just pre-navigated.

### Action merging & display

- External actions get a `source` field on the `Action` type
- IDs are prefixed with source name to avoid conflicts: `"meetsmore/xcli-scripts:database/reset"`
- In the menu, external actions show their source as a dimmed suffix: `Deploy — meetsmore/xcli-scripts`
- Local actions always appear first in the menu, then external grouped by source

---

## Files to Create

### `src/core/fetcher.ts` — Fetcher abstraction

All source fetching goes through a `SourceFetcher` interface:

```ts
export interface SourceFetcher {
  fetch(source: SourceConfig, destDir: string): Promise<void>;
  readMeta(destDir: string): Promise<SourceMeta | null>;
  writeMeta(destDir: string, source: SourceConfig): Promise<void>;
}
```

A `GitFetcher` implements this for GitHub repos. Future backends (S3, HTTP tarball, local path) implement the same interface. The `sources.ts` orchestrator accepts a fetcher, defaulting to `GitFetcher`.

`GitFetcher.fetch()`:
- Runs `git clone --depth 1 --branch {ref} https://github.com/{repo}.git {tempDir}`
- Clones into a temp dir first, then does an atomic rename into the cache slot

### `src/core/sources.ts` — Source orchestration

Responsibilities:
- `loadCachedSources(xcliDir, sources)` → load actions from `.xcli/.cache/sources/` (fast, sync-ish)
- `refreshSources(xcliDir, sources, onUpdate, fetcher?)` → background fetch, calls `onUpdate(actions)` when done. Accepts optional fetcher (defaults to `GitFetcher`)
- `ensureCacheDir(xcliDir)` → create `.cache/sources/` and `.gitignore`
- Cache directory naming: `{owner}-{repo}-{ref}`

### `src/core/git-utils.ts` — Git remote detection

Responsibilities:
- `detectRepoIdentity(cwd)` → parse git remote to extract `{ org: string, repo: string }` or null
- Parses both SSH (`git@github.com:org/repo.git`) and HTTPS (`https://github.com/org/repo.git`) remotes
- Uses `git remote get-url origin` via `Bun.spawn`

## Files to Modify

### `src/types.ts`

Add:
```ts
export interface SourceConfig {
  repo: string;      // "org/repo-name"
  ref?: string;       // Git ref, default "main"
}

export interface ActionSource {
  type: "local" | "github";
  label: string;      // "meetsmore/xcli-scripts" or "local"
}

export interface SourceMeta {
  fetchedAt: string;  // ISO timestamp
  repo: string;
  ref: string;
}
```

Extend `XcliConfig`:
```ts
export interface XcliConfig {
  // ... existing fields
  sources?: SourceConfig[];
}
```

Extend `Action`:
```ts
export interface Action {
  // ... existing fields
  source: ActionSource;
}
```

Extend `MenuItem`:
```ts
export interface MenuItem {
  // ... existing fields
  source?: string;    // Dimmed source label for external actions
}
```

### `src/core/loader.ts`

- `loadActions` needs to accept an optional `ActionSource` to tag loaded actions
- Actions from external sources get prefixed IDs: `"{source-label}:{id}"`

### `src/app.tsx`

Loading flow changes:
```
1. loadConfig(xcliDir)
2. loadActions(localActionsDir)                  → setActions(local)     [instant]
3. loadCachedSources(xcliDir, config.sources)    → setActions(local + cached) [instant]
4. refreshSources(xcliDir, config.sources, (freshActions) => {
     setActions(local + freshActions)             [background update]
   })
5. If repo identity matches a scoped dir, auto-push that menu screen
```

The auto-navigate logic:
- After actions load, detect repo identity via `detectRepoIdentity(cwd)`
- Find if any external source has a matching `@{org}/{repo}` category
- If so, push `{ type: "menu", path: ["@org", "repo"] }` onto the navigation stack
- Only auto-navigate once (on initial load), not on background refresh

### `src/core/config.ts`

- Add `sources` field to config loading/defaults

### `src/components/StatusBar.tsx`

- Show a syncing indicator while background refresh is in progress

### Menu rendering in `app.tsx`

- `buildMenuItems` needs to include `source` field on MenuItem
- Render source label as dimmed text after description for external actions

---

## Implementation Order (TDD)

### Step 1: Types & git-utils

**Tests first** (`test/git-utils.test.ts`):
- Parse SSH remote → `{ org: "meetsmore", repo: "api-server" }`
- Parse HTTPS remote → same
- Handle `.git` suffix
- Handle missing remote → null
- Handle non-git directory → null

**Implement** `src/core/git-utils.ts`

### Step 2: Fetcher abstraction & GitFetcher

**Tests first** (`test/fetcher.test.ts`):
- `GitFetcher` implements `SourceFetcher` interface
- Clone a source into a temp dir (use a real small public repo or mock git)
- `writeMeta` / `readMeta` round-trip `.source-meta.json`
- Handle clone failure gracefully (rejects promise, doesn't throw)
- A mock `SourceFetcher` can be injected into `refreshSources` for testing without network

**Implement** `src/core/fetcher.ts` (interface + `GitFetcher`)

### Step 3: Source orchestration & caching

**Tests first** (`test/sources.test.ts`):
- `loadCachedSources` returns empty if no cache exists
- `loadCachedSources` returns actions from pre-populated cache fixture
- `ensureCacheDir` creates directory and .gitignore
- Actions from sources get correct `source` field and prefixed IDs
- Cache directory naming is correct
- `refreshSources` with mock `SourceFetcher` calls `onUpdate` with fetched actions

**Implement** `src/core/sources.ts`

**Fixture**: Create `test/fixtures/cached-source/` with a pre-built cache structure

### Step 4: Loader modifications

**Tests first** (`test/loader.test.ts` — extend existing):
- `loadActions` with source parameter tags actions correctly
- External action IDs are prefixed with source label

**Modify** `src/core/loader.ts`

### Step 5: Type changes & config

**Modify** `src/types.ts` — add new types, extend existing ones
**Modify** `src/core/config.ts` — handle `sources` field
**Update** existing tests for config loading with sources

### Step 6: App integration

**Modify** `src/app.tsx`:
- Load cached sources on startup
- Background refresh with callback
- Merge local + external actions
- Auto-navigate to scoped directory
- Show sync indicator

**Tests** (`test/navigation.test.ts` — extend):
- External actions appear in menu
- Source label shown for external actions
- Auto-navigation to scoped directory works

### Step 7: Polish

- Error handling edge cases (network down, invalid repo, empty source)
- Ensure `.cache/.gitignore` is created on first source fetch
- Sync status indicator in StatusBar

---

## Verification

1. Create a test GitHub repo with `.xcli/actions/` containing sample scripts
2. Add it as a source in a local `.xcli/config.ts`
3. Run `bun src/cli.tsx` — local actions appear immediately
4. After a moment, external actions appear in the menu
5. Kill network, restart — cached external actions still appear
6. Run `bun test` — all tests pass
7. Test scoping: set up `@org/repo` dirs in external source, verify auto-navigation
