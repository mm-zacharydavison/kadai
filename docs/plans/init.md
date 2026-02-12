# xcli — Initial Architecture Plan

## Context

xcli is a CLI tool that provides an interactive terminal UI for running housekeeping tasks in any repository. Users place scripts in a `.xcli/` directory, and xcli discovers them, presents them in a navigable menu with fuzzy search, runs them, and streams output — all within a polished terminal interface.

The tool is distributed via `bunx xcli` (no global install required) and built entirely on Bun.

## Goals (Phased)

| Phase | Goal                                                           | Status  |
| ----- | -------------------------------------------------------------- | ------- |
| 1     | Interactive CLI UI + `.xcli` directory loading                 | Current |
| 2     | External sources (repos, gists) with caching                  | Future  |
| 3     | AI generation of scripts with commit prompting                 | Future  |

---

## 1. Project Structure

```
xcli/
├── src/
│   ├── cli.tsx                  # Entry point (bin). Arg parsing, renders <App />
│   ├── app.tsx                  # Root component. Navigation state, screen router
│   ├── components/
│   │   ├── MenuScreen.tsx       # Displays a list of actions/categories with fuzzy filter
│   │   ├── ActionOutput.tsx     # Streams and displays output from a running script
│   │   ├── SearchInput.tsx      # Inline fuzzy search input bar
│   │   ├── Breadcrumbs.tsx      # Shows navigation path (Home > Category > ...)
│   │   └── StatusBar.tsx        # Bottom bar with keybind hints
│   ├── core/
│   │   ├── loader.ts            # Discovers and parses actions from .xcli/actions/
│   │   ├── runner.ts            # Spawns scripts, streams stdout/stderr
│   │   ├── metadata.ts          # Parses metadata from script comments/config
│   │   └── config.ts            # Loads .xcli/config.ts repo-level configuration
│   └── types.ts                 # Shared type definitions
├── test/
│   ├── loader.test.ts           # Tests for action discovery and metadata parsing
│   ├── runner.test.ts           # Tests for script execution
│   ├── metadata.test.ts         # Tests for metadata extraction from comments
│   └── components/
│       ├── MenuScreen.test.tsx  # Ink testing-library tests
│       └── ActionOutput.test.tsx
├── package.json
├── tsconfig.json
└── docs/
    └── plans/
        └── init.md              # This plan
```

---

## 2. `.xcli` Directory Convention

Repos that use xcli create a `.xcli/` directory at their root:

```
.xcli/
├── config.ts                    # Optional repo-level configuration
└── actions/
    ├── deploy/                  # Category (becomes submenu)
    │   ├── staging.sh
    │   └── production.sh
    ├── database/
    │   ├── reset.ts
    │   ├── seed.ts
    │   └── migrate.sh
    └── cleanup.py               # Top-level action (no category)
```

**Rules:**
- Directories under `actions/` become **categories** (submenus)
- Files directly in `actions/` appear at the **top level** of the menu
- Supported extensions: `.ts`, `.sh`, `.bash`, `.py`, `.js`, `.mjs`
- Files starting with `_` or `.` are ignored
- Nested categories (subdirectories of subdirectories) are supported up to 3 levels deep

---

## 3. Action Metadata Format

Every script can declare metadata. If no metadata is found, xcli infers from the filename.

### Comment Frontmatter (all languages)

All script types use the same `xcli:<key> <value>` comment frontmatter, with the comment prefix matching the language:

```bash
#!/bin/bash
# xcli:name Deploy to Staging
# xcli:emoji 🚀
# xcli:description Deploy the current branch to staging environment
# xcli:confirm true

set -euo pipefail
echo "Deploying..."
```

```python
#!/usr/bin/env python3
# xcli:name Generate Report
# xcli:emoji 📊
# xcli:description Generate monthly analytics report

import subprocess
...
```

```ts
// xcli:name Reset Database
// xcli:emoji 🗑️
// xcli:description Drop and recreate the dev database
// xcli:confirm true

await $`dropdb myapp_dev`;
await $`createdb myapp_dev`;
await $`bun run db:migrate`;
```

The metadata parser recognizes both `#` and `//` comment prefixes, scanning the first 20 lines of any file.

### TypeScript / JavaScript Actions (with exports)

TS/JS files can optionally export a `meta` object and `run` function for richer integration (e.g. programmatic access to `ActionContext`):

```ts
// .xcli/actions/database/reset.ts
import type { ActionMeta, ActionContext } from "xcli";

export const meta: ActionMeta = {
  name: "Reset Database",
  emoji: "🗑️",
  description: "Drop and recreate the dev database",
  confirm: true,
};

export async function run(ctx: ActionContext) {
  await ctx.exec("dropdb myapp_dev");
  await ctx.exec("createdb myapp_dev");
  await ctx.exec("bun run db:migrate");
}
```

**Resolution order**: comment frontmatter > exported `meta` object > filename inference. This means simple scripts with just frontmatter comments work identically across all languages, while TS/JS files can opt into the richer `run()` API when needed.

### Fallback (No Metadata)

If no metadata is found:
- `name` = filename with extension stripped, hyphens/underscores converted to spaces, title-cased
  - `reset-db.sh` → "Reset Db"
- `description` = empty
- `confirm` = false

---

## 4. Type Definitions (`src/types.ts`)

```ts
export interface ActionMeta {
  name: string;
  emoji?: string;             // Emoji displayed before the name in menus
  description?: string;
  confirm?: boolean;          // Require confirmation before running
  hidden?: boolean;           // Hide from menu (still searchable)
}

export interface Action {
  id: string;                 // Unique path-based ID: "database/reset"
  meta: ActionMeta;
  filePath: string;           // Absolute path to the script file
  category: string[];         // ["database"] or [] for top-level
  runtime: Runtime;           // How to execute it
}

export type Runtime = "bun" | "node" | "bash" | "python" | "executable";

export interface ActionContext {
  exec: (cmd: string) => Promise<ExecResult>;
  cwd: string;
  repoRoot: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MenuItem {
  type: "action" | "category";
  label: string;
  description?: string;
  value: string;              // Action ID or category path
}

export interface NavigationState {
  stack: Screen[];
}

export type Screen =
  | { type: "menu"; path: string[]; }           // path=[] is root
  | { type: "output"; actionId: string; };

export interface XcliConfig {
  actionsDir?: string;        // Default: "actions"
  env?: Record<string, string>;
  hooks?: {
    before?: string;          // Run before any action
    after?: string;           // Run after any action
  };
}
```

---

## 5. Component Hierarchy & Navigation Model

Ink renders **inline** by default — it does not use an alternate screen buffer like vim/less. Output appears in the normal terminal flow and remains in scrollback after exit. This is exactly what we want: no fullscreen takeover, just an interactive prompt inline in the terminal.

```
<App>                          # Navigation state, screen router
├── <Breadcrumbs />            # "xcli > database > reset"
├── {screen.type === "menu" && (
│     <MenuScreen>             # Current menu items + fuzzy filter
│       <SearchInput />        # "/" to activate, ESC to clear
│       <SelectList />         # ink-select-input with filtered items
│     </MenuScreen>
│   )}
├── {screen.type === "output" && (
│     <ActionOutput>           # Streams script output
│       <Static> lines </Static>
│       <Spinner /> (while running)
│       <StatusBar /> (exit code when done)
│     </ActionOutput>
│   )}
└── <StatusBar />              # "↑↓ navigate  / search  ← back  q quit"
```

### Navigation Model (Stack-Based)

- **State**: A stack of `Screen` objects. Top of stack = current view.
- **Push**: Selecting a category pushes a new menu screen. Selecting an action pushes an output screen.
- **Pop**: `ESC` or `Backspace` on an empty search pops the stack (go back). At root, `ESC`/`q` exits.
- **Global keys**:
  - `q` / `Ctrl+C` — quit from anywhere
  - `/` — focus search input
  - `ESC` — go back (or clear search if search is active)
  - `Enter` — select item
  - `↑`/`↓` or `j`/`k` — navigate list

---

## 6. Core Modules

### `src/core/loader.ts` — Action Discovery

1. Find repo root (walk up looking for `.xcli/` or `.git/`)
2. Read `.xcli/config.ts` if present (via `import()`)
3. Recursively scan `.xcli/actions/` directory
4. For each file:
   - Determine runtime from extension (`.ts` → bun, `.sh` → bash, `.py` → python)
   - Extract metadata via `metadata.ts`
   - Build `Action` object with category derived from directory path
5. Return sorted list of actions

### `src/core/metadata.ts` — Metadata Extraction

Unified approach for all file types:
1. Read first 20 lines, extract `xcli:<key> <value>` from comment lines (`#` or `//` prefix)
2. For TS/JS files only: if no frontmatter found, attempt `import()` and read `.meta` export
3. Fall back to filename inference (title-case, strip extension, replace hyphens/underscores)

### `src/core/runner.ts` — Script Execution

```ts
function runAction(action: Action, options: { cwd: string }): ChildProcess
```

- Maps runtime to command:
  - `bun` → `bun run <file>`
  - `bash` → `bash <file>`
  - `python` → `python3 <file>`
  - `executable` → `./<file>` (if file has +x)
- Spawns child process with `Bun.spawn()`
- Returns handle with streaming stdout/stderr readers
- Inherits environment from parent + any `.xcli/config.ts` env overrides

### `src/core/config.ts` — Configuration

Loads `.xcli/config.ts` via dynamic import. Validates against `XcliConfig` schema. Provides defaults.

---

## 7. Package Distribution

### `package.json`

```json
{
  "name": "xcli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "xcli": "./src/cli.tsx"
  },
  "files": ["src/", "README.md"],
  "dependencies": {
    "ink": "^6.7.0",
    "react": "^18.3.1",
    "ink-text-input": "^6.0.0",
    "ink-select-input": "^6.2.0",
    "ink-spinner": "^5.0.0",
    "fuzzysort": "^3.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/react": "^18.3.0",
    "ink-testing-library": "^4.0.0",
    "typescript": "^5"
  }
}
```

### Usage

```sh
# Run in any repo with a .xcli/ directory
bunx xcli

# Or with args (future)
bunx xcli --help
bunx xcli run database/reset    # Run action directly without UI
bunx xcli list                  # List all available actions
```

The `src/cli.tsx` file starts with `#!/usr/bin/env bun` shebang for direct execution.

---

## 8. Testing Strategy

| Layer      | Tool                  | What to test                                    |
| ---------- | --------------------- | ----------------------------------------------- |
| Core logic | `bun:test`            | Loader discovery, metadata parsing, config load |
| Runner     | `bun:test`            | Script execution, exit codes, output capture    |
| Components | `ink-testing-library` | Rendering, navigation, keyboard input           |
| E2E        | `bun:test` + fixtures | Full flow: discover → render → run → output     |

### Test Fixtures

```
test/
  fixtures/
    basic-repo/
      .xcli/
        actions/
          hello.sh           # Simple echo script with frontmatter
          cleanup.py         # Top-level action, no metadata (filename inference)
          database/
            reset.ts         # TS action with meta export
            seed.py          # Python script with frontmatter
            migrate.sh       # Bash script with frontmatter
    empty-repo/
      .xcli/
        actions/             # Empty directory (tests empty state)
    no-xcli-repo/            # No .xcli directory at all (tests missing state)
    nested-repo/
      .xcli/
        actions/
          deploy/
            staging/
              us-east.sh     # 2 levels deep (within limit)
              eu-west.sh
    config-repo/
      .xcli/
        config.ts            # Custom config with env vars and hooks
        actions/
          test.sh
```

### Test Cases

#### `test/metadata.test.ts` — Metadata Extraction

| Test                                        | Input                                        | Expected                                               |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| Parses `#` comment frontmatter              | `# xcli:name Foo\n# xcli:emoji 🔥`          | `{ name: "Foo", emoji: "🔥" }`                        |
| Parses `//` comment frontmatter             | `// xcli:name Bar\n// xcli:description Desc` | `{ name: "Bar", description: "Desc" }`                |
| Parses `confirm` as boolean                 | `# xcli:confirm true`                        | `{ confirm: true }`                                    |
| Parses `hidden` as boolean                  | `# xcli:hidden true`                         | `{ hidden: true }`                                     |
| Ignores lines without `xcli:` prefix        | `# just a comment\n# xcli:name Foo`          | `{ name: "Foo" }`                                      |
| Only scans first 20 lines                   | Metadata on line 21                           | Falls back to filename inference                       |
| Falls back to filename when no frontmatter  | File with no `xcli:` comments                | `{ name: "Reset Db" }` from `reset-db.sh`             |
| Handles mixed `#` and `//` (uses first hit) | `# xcli:name A\n// xcli:name B`              | `{ name: "A" }`                                        |
| TS export fallback                          | `.ts` with `export const meta` but no frontmatter | Reads exported `meta` object                      |
| TS frontmatter takes priority over export   | `.ts` with both frontmatter and `meta` export | Frontmatter wins                                      |

#### `test/loader.test.ts` — Action Discovery

| Test                                        | Fixture           | Expected                                                    |
| ------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| Discovers top-level actions                 | `basic-repo`      | Finds `hello.sh` and `cleanup.py` with `category: []`      |
| Discovers categorized actions               | `basic-repo`      | Finds `database/reset.ts` etc. with `category: ["database"]` |
| Assigns correct runtimes                    | `basic-repo`      | `.ts` → bun, `.sh` → bash, `.py` → python                  |
| Ignores dotfiles and underscored files      | fixture with `_helper.sh`, `.hidden.sh` | Not included in results          |
| Handles nested categories                   | `nested-repo`     | `deploy/staging/us-east.sh` with `category: ["deploy", "staging"]` |
| Returns empty array for empty actions dir   | `empty-repo`      | `[]`                                                        |
| Throws/errors when no `.xcli` dir found     | `no-xcli-repo`    | Appropriate error                                           |
| Sorts actions alphabetically within category | `basic-repo`     | Actions sorted by name within each category                 |
| Builds correct action IDs from paths        | `basic-repo`      | `"database/reset"`, `"database/seed"`, `"hello"`, etc.     |

#### `test/runner.test.ts` — Script Execution

| Test                                        | Setup                                        | Expected                                          |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Runs a bash script                          | `echo "hello"` script                        | stdout contains `"hello"`, exit code 0            |
| Runs a TypeScript script via bun            | `console.log("hi")` script                   | stdout contains `"hi"`, exit code 0               |
| Runs a Python script                        | `print("hey")` script                        | stdout contains `"hey"`, exit code 0              |
| Captures stderr                             | Script that writes to stderr                  | stderr captured separately                        |
| Reports non-zero exit codes                 | `exit 1` script                              | exit code 1                                       |
| Inherits env from config                    | Config with `env: { FOO: "bar" }`            | Script can read `$FOO` / `process.env.FOO`        |
| Streams output incrementally                | Script with `sleep` between outputs           | Lines arrive as they're produced, not all at once |
| Runs in repo root cwd                       | Script that prints `pwd`                      | Output matches repo root path                     |

#### `test/config.test.ts` — Configuration

| Test                                        | Setup                                        | Expected                                          |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Loads config.ts with env vars               | `config-repo` fixture                        | Parsed `XcliConfig` with env populated            |
| Returns defaults when no config.ts exists   | `basic-repo` fixture                         | Default `XcliConfig` values                       |
| Merges config env with process env           | Config env + existing process env             | Config env overrides, process env preserved       |

#### `test/components/MenuScreen.test.tsx` — Menu Rendering

| Test                                        | Setup                                        | Expected                                          |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Renders list of actions                     | 3 actions passed as props                    | All 3 visible in output                           |
| Renders categories as submenu items         | Actions with categories                      | Category names shown as navigable items           |
| Shows emoji before action name              | Action with `emoji: "🚀"`                   | `🚀 Deploy` rendered                              |
| Fuzzy search filters items                  | Type `"dep"` into search                     | Only matching actions shown                       |
| Search clears on ESC                        | Active search → ESC                          | Full list restored                                |
| Empty search shows all items                | No search input                              | All items visible                                 |
| Shows description alongside name            | Actions with descriptions                    | Descriptions rendered                             |

#### `test/components/ActionOutput.test.tsx` — Output Display

| Test                                        | Setup                                        | Expected                                          |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Shows spinner while running                 | Action in progress                           | Spinner visible                                   |
| Displays streamed stdout lines              | Mock process emitting lines                  | Lines appear in output                            |
| Shows exit code on completion               | Process exits with code 0                    | Success indicator shown                           |
| Shows error state for non-zero exit         | Process exits with code 1                    | Error indicator with exit code                    |

#### `test/components/Navigation.test.tsx` — Navigation Stack

| Test                                        | Setup                                        | Expected                                          |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Starts at root menu                         | App rendered                                 | Root menu visible, stack depth 1                  |
| Enter on category pushes submenu            | Select a category                            | Submenu rendered, breadcrumbs updated             |
| ESC pops back to parent                     | In submenu → ESC                             | Parent menu restored                              |
| ESC at root exits app                       | At root → ESC                                | App unmounts                                      |
| Breadcrumbs reflect current path            | Navigate to `database`                       | Breadcrumbs show `xcli > database`                |
| Enter on action pushes output screen        | Select an action                             | ActionOutput rendered                             |
| ESC from output returns to menu             | In output → ESC                              | Menu restored at same position                    |

---

## 9. Implementation Order

### Phase 1a — Skeleton (get something running)
1. Install dependencies (ink, react, fuzzysort, etc.)
2. Create `src/types.ts` with all type definitions
3. Create `src/cli.tsx` entry point with shebang
4. Create `src/app.tsx` with basic Ink render + placeholder text
5. Verify `bunx .` works locally

### Phase 1b — Core: Loading Actions
1. Write tests for `loader.ts` using fixture repos
2. Implement `src/core/metadata.ts` — comment frontmatter parser
3. Implement `src/core/loader.ts` — directory scanning + action building
4. Write tests for metadata extraction

### Phase 1c — Core: Running Actions
1. Write tests for `runner.ts`
2. Implement `src/core/runner.ts` — spawn scripts, stream output
3. Implement `src/core/config.ts` — load repo config

### Phase 1d — UI: Menu & Navigation
1. Implement `src/components/MenuScreen.tsx` — list with fuzzy search
2. Implement `src/components/SearchInput.tsx` — inline search bar
3. Implement `src/components/Breadcrumbs.tsx`
4. Implement `src/components/StatusBar.tsx`
5. Implement navigation stack in `src/app.tsx`

### Phase 1e — UI: Action Execution
1. Implement `src/components/ActionOutput.tsx` — streamed output display
2. Wire up: select action → run → show output → back to menu
3. Add confirmation prompt for `confirm: true` actions

### Phase 1f — Polish
1. Error handling (missing `.xcli/`, bad scripts, permission errors)
2. Empty states (no actions found)
3. Graceful process cleanup on exit (kill child processes)
4. Help text and `--help` flag

---

## 10. Future Extensibility

### Goal 2 — External Sources

The default action source is always the local `.xcli/actions/` directory. However, the primary use case for external sources is a **shared scripts repo** within an organization, where team members have push access.

#### Org/Repo Scoping Convention

Scripts in a shared source can be scoped to specific repos using `@org/repo` directory naming:

```
shared-xcli-scripts/          # The shared repo
├── .xcli/
│   └── actions/
│       ├── general/           # Available everywhere
│       │   └── lint-all.sh
│       ├── @meetsmore/        # Org-level scope
│       │   ├── common/        # Available in all @meetsmore repos
│       │   │   └── deploy.sh
│       │   ├── api-server/    # Only shown when working in @meetsmore/api-server
│       │   │   ├── migrate.sh
│       │   │   └── seed.ts
│       │   └── web-app/       # Only shown when working in @meetsmore/web-app
│       │       └── build.sh
```

When xcli runs, it detects the current repo's git remote (e.g. `github.com/meetsmore/api-server`) and automatically navigates to the matching `@meetsmore/api-server/` directory in the menu. The user can press `ESC` to go back up and browse other repos or unscoped actions — nothing is hidden or filtered out.

#### Configuration

```
.xcli/
  config.ts              # Add `sources` field
  actions/               # Local actions
  .cache/                # Cached external actions (gitignored)
```

```ts
// .xcli/config.ts
export default {
  sources: [
    { type: "github", repo: "meetsmore/xcli-scripts", ref: "main" },
    { type: "gist", id: "abc123" },
  ],
};
```

A `src/external/` module would handle fetching, caching (in `.xcli/.cache/`), and staleness checks. External actions appear alongside local ones in the menu, tagged with their source.

### Goal 3 — AI Script Generation

Add a special menu item "Generate new action..." that:
1. Prompts for a description of what the script should do
2. Invokes Claude Code locally (via `claude` CLI) to generate the script, leveraging the user's existing Max plan
3. Shows a preview of the generated script
4. Runs it in a sandboxed mode (with confirmation)
5. Prompts: "Save this action for the team?" → writes to `.xcli/actions/` and offers to `git add + commit`

The primary generation method is **local Claude Code** (`claude` CLI), so users on Max plans get generation at no extra API cost. External AI APIs (OpenAI, Anthropic API directly, etc.) can be supported as a future alternative for users without Claude Code installed.

This lives in `src/ai/` and hooks into the existing menu system as a special action type.

---

## Verification

After implementation, verify with:

1. Create a test `.xcli/actions/` directory with sample scripts (bash, ts, python)
2. Run `bun src/cli.tsx` from the repo root
3. Confirm: menu renders, categories show as submenus, fuzzy search filters items
4. Select an action → output streams in real-time → back returns to menu
5. Run `bun test` — all unit and component tests pass
6. Run `bunx .` — verify package works as a bunx target
