# AI Script Generation (Goal 3) — Implementation Plan

## Context

xcli currently lets users browse and run scripts from `.xcli/actions/`. This plan adds AI-powered script generation: the user presses `n` from the menu, xcli spawns an interactive Claude Code session with context about xcli conventions, and the user describes what they want. When the Claude session ends, xcli detects any new files created in `.xcli/actions/`, and offers to share them to configured external sources.

The generation method is **local Claude Code** (`claude` CLI), so users on Max plans get generation at no extra API cost. The `claude` CLI is invoked as an interactive subprocess with `stdio: "inherit"` — the user gets a full Claude Code experience, not a stripped-down wrapper.

---

## User Flow

```
1. User is in the xcli menu
2. Presses 'n' (shown in StatusBar as a hint)
3. xcli takes a snapshot of .xcli/actions/ (list of existing files)
4. Ink unmounts, terminal control passes to Claude Code
5. Claude opens with an appended system prompt containing xcli conventions
   and an initial prompt introducing itself as an xcli action generator
6. User describes what they want, interacts with Claude normally
7. User exits Claude (Ctrl+C, /exit, or 'q')
8. xcli diffs .xcli/actions/ against the snapshot to find new files
9. Ink re-mounts:
   a. If no new files: flash "No new actions created" → return to menu
   b. If new files found: push a ShareScreen showing new actions with sharing options
10. User picks a destination for each new action (or skips)
11. Return to menu (new actions now appear in the list)
```

---

## Design

### Keybinding: `n` for "new"

Handled in `app.tsx`'s `useInput` when on a menu screen (not in search mode). The `n` key triggers AI generation. The StatusBar updates to show the hint: `n new`.

### Ink suspend/resume

Ink renders inline — there's no alternate screen buffer. To hand terminal control to Claude:

1. Call `instance.unmount()` on the Ink render instance (exposed via a callback prop or a ref)
2. Spawn `claude` with `stdio: "inherit"` so it gets full terminal control
3. `await proc.exited` to wait for Claude to finish
4. Re-mount the Ink app with `render(<App />)`, starting on the post-generation screen

This requires restructuring `cli.tsx` slightly: the render loop becomes a `while` loop that alternates between Ink sessions and Claude sessions. The `App` component signals "spawn claude" by calling a callback, and `cli.tsx` handles the unmount/spawn/remount orchestration.

```
cli.tsx main loop:

while (true) {
  const result = await renderInkApp()    // returns: "exit" | "spawn-claude"
  if (result === "exit") break
  if (result === "spawn-claude") {
    const snapshot = await snapshotActions(actionsDir)
    await spawnClaude(xcliDir, actionsDir, snapshot)
    const newFiles = await diffActions(actionsDir, snapshot)
    // Next Ink render starts on ShareScreen if newFiles.length > 0
  }
}
```

### AI provider abstraction

Generation is modeled as a pluggable **provider** so xcli can support different backends in the future (e.g. Codex CLI, opening ChatGPT on the web). Each provider implements a common interface:

```ts
export interface AIProvider {
  name: string;
  /** Check if the provider's CLI/tool is available */
  isAvailable(): Promise<boolean>;
  /** Whether this provider needs Ink to unmount (terminal-based providers do, web-based don't) */
  requiresUnmount: boolean;
  /** Spawn the generation session. Resolves when the session ends. */
  spawn(opts: { xcliDir: string; actionsDir: string; systemPrompt: string }): Promise<void>;
}
```

The initial (and only) provider is `ClaudeCodeProvider`, which spawns the `claude` CLI:

```sh
claude \
  --append-system-prompt "<xcli conventions>" \
  "I'm ready to create a new xcli action. Describe what you'd like the script to do."
```

Flags used:
- `--append-system-prompt`: Injects xcli-specific instructions without replacing Claude's default system prompt
- Positional `prompt` argument: Prefills the conversation with an opening message so the user knows what to do

The process is spawned with `Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"] })` to give Claude full terminal access (raw mode, colors, Ink rendering, etc).

The `requiresUnmount` flag lets `cli.tsx` decide whether to unmount Ink before spawning. Terminal-based providers (Claude CLI, Codex) set this to `true`; future web-based providers (e.g. open ChatGPT in browser) would set it to `false` and launch without disrupting the TUI.

### System prompt content

The appended system prompt tells Claude how to write xcli actions. It includes:

1. **Directory convention**: Where to place files (`.xcli/actions/`, categories as subdirectories)
2. **Metadata format**: Comment frontmatter (`# xcli:name`, `# xcli:emoji`, etc.)
3. **Supported languages**: `.sh`, `.ts`, `.py`, `.js`, `.mjs` with their runtimes
4. **Current repo context**: The absolute path to `.xcli/actions/`, and a listing of existing actions (so Claude can see what's already there and avoid conflicts)
5. **Best practices**: Use shebangs, set -euo pipefail for bash, keep scripts self-contained

The prompt is built dynamically at generation time by `src/ai/prompt.ts` so it reflects the current state of the repo.

### File diff detection

Before spawning Claude, take a snapshot:

```ts
type Snapshot = Map<string, number>  // filePath → mtime (ms)
```

After Claude exits, scan `.xcli/actions/` again. New files = paths present in the new scan but absent from the snapshot. Modified files = paths where mtime changed. Both are surfaced to the user.

### ShareScreen

A new screen type shown after Claude exits (if new files were detected). Displays:

```
New actions created:

  ✦ Deploy to Staging  (.xcli/actions/deploy/staging.sh)
  ✦ Reset Cache        (.xcli/actions/reset-cache.ts)

Share to:
  ❯ Keep in .xcli
    Push to meetsmore/xcli-scripts
    Push to myorg/shared-ops

Press enter to confirm, esc to skip sharing
```

The sharing destinations come from the `sources` array in `.xcli/config.ts` (Goal 2 infrastructure). If no sources are configured, the share step is skipped entirely — the user just sees a confirmation that new actions were created and returns to the menu.

### Pushing to a source

When the user selects an external source:

1. Clone (or use cached clone of) the source repo into a temp directory
2. Determine the target path within the source repo:
   - Detect current repo identity via `git-utils.ts` → `@org/repo/` scoping
   - If no identity detected, place in root `actions/`
3. Copy the new action file(s) into the target path
4. Create a branch: `xcli/add-{action-id}-{timestamp}`
5. Commit with message: `Add {action name} action`
6. Push the branch
7. Open a PR via `gh pr create` (if `gh` is available) or print the push URL

This reuses the `GitFetcher` infrastructure from Goal 2. If Goal 2 isn't implemented yet, the share-to-source feature is disabled (grayed out in the UI with a "configure sources in .xcli/config.ts" hint).

---

## Files to Create

### `src/ai/prompt.ts` — System prompt builder

Builds the `--append-system-prompt` string dynamically:

```ts
export async function buildSystemPrompt(
  xcliDir: string,
  actionsDir: string,
): Promise<string>
```

Reads the current actions directory listing and embeds it in the prompt alongside static xcli conventions documentation.

### `src/ai/provider.ts` — AI provider interface and Claude implementation

Defines the `AIProvider` interface and exports the `ClaudeCodeProvider`:
- `AIProvider` interface: `name`, `isAvailable()`, `requiresUnmount`, `spawn(opts)`
- `ClaudeCodeProvider`: implements `AIProvider` using `claude` CLI with `Bun.spawn`
- `getDefaultProvider()` → returns `ClaudeCodeProvider` (future: configurable)

### `src/ai/generate.ts` — Snapshot, diff, and orchestration

Responsibilities:
- `snapshotActions(actionsDir)` → `Map<string, number>` (path → mtime)
- `detectNewActions(actionsDir, snapshot)` → `Action[]` (newly created or modified actions, parsed with loader)
- `generate(provider, xcliDir, actionsDir)` → orchestrates: build prompt → spawn provider → detect new actions

### `src/ai/share.ts` — Sharing to external sources

Responsibilities:
- `shareToSource(actions, source, repoIdentity)` → clone, copy, branch, commit, push
- `openPR(source, branchName, actions)` → create PR via `gh` CLI (best-effort)
- Returns a result object with status and URL/error for the UI to display

### `src/components/ShareScreen.tsx` — Post-generation UI

A React component showing:
- List of newly created actions (parsed metadata: name, emoji, file path)
- Share destination picker (local / each configured source)
- Status feedback after sharing (success/failure per destination)
- ESC to skip sharing and return to menu

---

## Files to Modify

### `src/types.ts`

Add to Screen union:
```ts
| { type: "ai-generate" }   // Transitional: triggers Claude spawn from cli.tsx
```

Add new types:
```ts
export interface GenerationResult {
  newActions: Action[];
}
```

### `src/cli.tsx`

Restructure from a single render call to a loop that handles alternating between Ink and Claude sessions. The App component communicates via a callback/promise when the user wants to spawn Claude.

### `src/app.tsx`

- Add `n` key handler in menu screen (not in search mode) → signal AI generation
- Accept `generationResult` prop for post-Claude re-mount
- If `generationResult` has new actions, start on ShareScreen instead of menu
- Add `onRequestGenerate` callback prop for signaling cli.tsx

### `src/components/StatusBar.tsx`

Add `n new` hint to the status bar text.

### `src/core/loader.ts`

No changes to `loadActions` itself, but the `snapshotActions` / `detectNewActions` functions in `generate.ts` will use `loadActions` internally to parse the newly created files.

---

## Implementation Order (TDD)

### Step 1: Types & prompt builder

**Tests first** (`test/ai/prompt.test.ts`):

| Test                                     | Input                                      | Expected                                             |
| ---------------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| Includes xcli metadata format docs       | Any actionsDir                             | Prompt contains `xcli:name`, `xcli:emoji` examples   |
| Includes supported extensions            | Any actionsDir                             | Prompt mentions `.sh`, `.ts`, `.py`                  |
| Lists existing actions                   | actionsDir with `hello.sh`, `db/reset.ts`  | Prompt contains both filenames                       |
| Handles empty actions directory          | Empty actionsDir                           | Prompt says "no existing actions"                    |
| Includes the absolute actions dir path   | `/home/user/project/.xcli/actions`         | Prompt contains that path                            |

**Implement** `src/ai/prompt.ts`

### Step 2: Snapshot and diff

**Tests first** (`test/ai/generate.test.ts`):

| Test                                        | Setup                                           | Expected                                        |
| ------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Snapshot captures all files with mtimes     | `basic-repo` fixture                            | Map has entries for each action file             |
| Snapshot ignores dotfiles and `_` prefixed  | Fixture with `.hidden.sh` and `_helper.sh`      | Not in snapshot                                 |
| Diff detects new file                       | Snapshot without `new.sh`, dir with `new.sh`    | `new.sh` in result                              |
| Diff detects modified file                  | Snapshot with old mtime, file with newer mtime  | File in result                                  |
| Diff returns empty when nothing changed     | Identical snapshot and dir                       | Empty array                                     |
| Diff detects new files in subdirectories    | New file in `deploy/staging.sh`                 | Found in result with correct category           |
| Pre-flight returns false when claude missing | `Bun.which("claude")` returns null             | `isClaudeInstalled()` returns false             |

**Implement** `src/ai/generate.ts` (snapshot, diff, and pre-flight only — spawning tested in integration)

### Step 3: StatusBar hint & keybinding

**Modify** `src/components/StatusBar.tsx` — add `n new` to hints

**Modify** `src/app.tsx`:
- Add `n` key handler in menu mode (when not searching)
- Add `onRequestGenerate` callback prop
- Handle `generationResult` prop for post-generation flow

**Tests** (`test/navigation.test.ts` — extend):
- Pressing `n` on menu screen triggers onRequestGenerate callback
- Pressing `n` during search does NOT trigger generation (types 'n' into search)
- Pressing `n` on output/confirm screen does nothing

### Step 4: CLI orchestration loop

**Modify** `src/cli.tsx`:
- Restructure into a render loop
- Handle unmount → spawn claude → remount cycle
- Pass `generationResult` to App on re-mount

**Integration test** (`test/ai/integration.test.ts`):
- Mock `claude` CLI with a script that creates a file in `.xcli/actions/`
- Verify xcli detects the new file after the mock exits
- Verify xcli re-renders with the new action in the menu

### Step 5: ShareScreen component

**Tests first** (`test/ai/share-screen.test.ts`):

| Test                                       | Setup                                         | Expected                                        |
| ------------------------------------------ | --------------------------------------------- | ----------------------------------------------- |
| Shows list of new actions                  | 2 new actions passed as props                 | Both action names visible                       |
| Shows "Keep in .xcli" option               | Any new actions                               | "Keep in .xcli" option visible                  |
| Shows configured sources as options        | Config with 2 sources                         | Both source repos listed                        |
| Hides source options when no sources       | Config with no sources                        | Only "Keep in .xcli" shown, no picker           |
| ESC returns to menu                        | Any state                                     | Calls onDone callback                           |
| Enter on "Keep in .xcli" returns to menu   | Select "Keep in .xcli"                        | Calls onDone without sharing                    |

**Implement** `src/components/ShareScreen.tsx`

### Step 6: Share-to-source logic

**Tests first** (`test/ai/share.test.ts`):

| Test                                       | Setup                                         | Expected                                        |
| ------------------------------------------ | --------------------------------------------- | ----------------------------------------------- |
| Clones source repo to temp dir             | Mock git, valid source config                 | `git clone --depth 1` called with correct args  |
| Copies action files to correct path        | New action + repo identity                    | File exists at `@org/repo/action.sh` in clone   |
| Creates branch with expected name          | New action named "deploy"                     | Branch name starts with `xcli/add-deploy-`      |
| Commits with descriptive message           | New action named "Deploy to Staging"          | Commit message contains action name             |
| Pushes branch to origin                    | Successful clone + commit                     | `git push` called                               |
| Falls back to root when no repo identity   | No git remote detected                        | File placed in `actions/` root of source        |
| Handles clone failure gracefully           | Network error during clone                    | Returns error result, no crash                  |

**Implement** `src/ai/share.ts`

### Step 7: Wire ShareScreen into app

**Modify** `src/app.tsx`:
- Add `ShareScreen` rendering when `generationResult` has new actions
- After sharing completes (or user skips), return to menu with refreshed action list
- Reload actions after generation to pick up new files

### Step 8: Polish

- Error state when `claude` CLI is not installed → show message with install instructions
- Handle Claude exiting with non-zero exit code (user Ctrl+C'd early) → still check for new files
- Handle very long system prompts (many existing actions) → truncate listing if > 50 actions
- Ensure the Ink app restores terminal state correctly after Claude exits (raw mode, cursor)

---

## Edge Cases

| Scenario                                 | Behavior                                                        |
| ---------------------------------------- | --------------------------------------------------------------- |
| `claude` CLI not installed               | Show inline error: "Claude CLI not found. Install: npm i -g @anthropic-ai/claude-code" |
| User exits Claude without creating files | Flash "No new actions created", return to menu                  |
| User modifies existing action in Claude  | Show modified action in ShareScreen alongside new ones          |
| Claude crashes mid-session               | Still diff actions dir, proceed normally                        |
| No external sources configured           | Skip share picker, just confirm new actions and return to menu  |
| `gh` CLI not available for PR creation   | Print push URL instead, skip PR creation                        |
| Source repo clone fails (auth, network)  | Show error in ShareScreen, offer to retry or skip               |
| User presses `n` but cancels immediately | Claude opens and user exits right away → no new files → back to menu |

---

## File Summary

| File                              | Change   |
| --------------------------------- | -------- |
| `src/types.ts`                    | Modify   |
| `src/cli.tsx`                     | Modify   |
| `src/app.tsx`                     | Modify   |
| `src/components/StatusBar.tsx`    | Modify   |
| `src/components/ShareScreen.tsx`  | **New**  |
| `src/ai/provider.ts`             | **New**  |
| `src/ai/prompt.ts`               | **New**  |
| `src/ai/generate.ts`             | **New**  |
| `src/ai/share.ts`                | **New**  |
| `test/ai/prompt.test.ts`         | **New**  |
| `test/ai/generate.test.ts`       | **New**  |
| `test/ai/share.test.ts`          | **New**  |
| `test/ai/share-screen.test.ts`   | **New**  |
| `test/ai/integration.test.ts`    | **New**  |

---

## Verification

1. Install Claude CLI locally, ensure `which claude` resolves
2. Run `bun src/cli.tsx` in a repo with `.xcli/actions/`
3. Press `n` → Claude opens with xcli context in the system prompt
4. Tell Claude to create a bash script that lists Docker containers
5. Verify Claude creates the file in `.xcli/actions/`
6. Exit Claude → xcli shows ShareScreen with the new action
7. Select "Keep in .xcli" → returns to menu, new action visible
8. Run `bun test` — all tests pass
9. Test with no `claude` CLI installed → error message shown
10. Test with external sources configured → share picker shows sources
