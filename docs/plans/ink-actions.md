# Plan: TSX Component Actions

## Context

Currently, all xcli actions run as subprocesses — their stdout/stderr is captured and rendered as plain text. This plan adds support for `.tsx` action files that export an Ink component, which gets rendered directly in the Ink render tree. This enables rich interactive UIs (forms, spinners, tables, progress bars, etc.) inside actions.

## Discrimination: `// xcli:component true`

A `.tsx` file is treated as a component action **only** if it has `// xcli:component true` in its frontmatter. Without this flag, `.tsx` files run as subprocesses (existing behavior for `.ts`). This fits naturally into the existing metadata system and avoids importing files at discovery time.

> TODO: If its .tsx, you can assume its an ink component. No need for frontmatter. Ink components arent supported for other filetypes.

## Changes

### 1. `src/types.ts` — Extend type system

- Add `component?: boolean` to `ActionMeta`
- Add `ComponentActionProps` interface:
  ```ts
  { cwd: string, meta: ActionMeta, exit: () => void, env: Record<string, string> }
  ```
- Add `"component"` to the `Screen` union: `| { type: "component"; actionId: string }`
  - A separate screen type makes routing cleaner than overloading `"output"`
- `Runtime` stays unchanged — component actions get `runtime: "bun"` from the `.tsx` extension; `meta.component` is the authoritative signal

### 2. `src/core/metadata.ts` — Parse `component` flag

- Add `case "component"` to the switch in `parseMetadataFromContent` (same pattern as `confirm`/`hidden`: `value.trim() === "true"`)
- Pass `component` through in `extractMetadata` return values (default `false`)

### 3. `src/core/loader.ts` — Accept `.tsx` extension

- Add `".tsx"` to `SUPPORTED_EXTENSIONS`
- Add `".tsx"` case to `runtimeFromExtension` → `"bun"`
- No other loader changes — component vs subprocess is determined by `meta.component`

### 4. `src/components/ComponentAction.tsx` — New file

Dynamic import wrapper that:
1. Calls `import(action.filePath)` to load the module
2. Validates `mod.default` is a function
3. Renders `<Component cwd={cwd} meta={meta} exit={exit} env={env} />`
4. Shows loading state during import, error state on failure

States: `loading` → `ready` (renders component) or `error` (shows message).

Props: `{ action: Action, cwd: string, config?: XcliConfig, onExit: () => void }`

### 5. `src/app.tsx` — Route component actions

Three code paths need updating to push `"component"` instead of `"output"` when the action has `meta.component`:

| Location       | Line | Current                                    | Change                                                                   |
|----------------|------|--------------------------------------------|--------------------------------------------------------------------------|
| Search enter   | 155  | `pushScreen({ type: "output", actionId })` | Check `action?.meta.component` → push `"component"` screen              |
| Normal enter   | 226  | `pushScreen({ type: "output", actionId })` | Check `action?.meta.component` → push `"component"` screen              |
| Confirm accept | 118  | `{ type: "output" as const, actionId }`    | Look up action, check `meta.component` → use `"component"` type if true |

Add to `useInput`:
- Handle `screen.type === "component"` same as `"output"` — ESC calls `popScreen()`

Add to render:
- New `if (currentScreen.type === "component")` block rendering `<ComponentAction>` instead of `<ActionOutput>`

### 6. Test fixtures — `test/fixtures/component-repo/.xcli/actions/`

| File                    | Purpose                                          |
|-------------------------|--------------------------------------------------|
| `greeting.tsx`          | Renders text with cwd prop — basic happy path    |
| `auto-exit.tsx`         | Calls `exit()` after render — tests self-exit    |
| `bad-export.tsx`        | Has `component: true` but no valid default export |
| `script-action.tsx`     | `.tsx` without `component` flag — runs as subprocess |
| `confirm-component.tsx` | Component with `confirm: true`                   |

### 7. Tests — `test/component.test.ts`

Written first (TDD). Covers:
- Loader assigns `meta.component: true` for `.tsx` with flag
- Loader keeps `meta.component` falsy for `.tsx` without flag
- Component renders inline (not as subprocess)
- Component receives `cwd` prop
- ESC returns from component to menu
- `exit()` callback returns to menu
- Invalid default export shows error message
- `.tsx` without flag runs as subprocess (shows exit code)
- Confirm flow works with component actions

Also add unit test in `test/metadata.test.ts` for parsing `component` flag.

## File Summary

| File                                | Change  |
|-------------------------------------|---------|
| `src/types.ts`                      | Modify  |
| `src/core/metadata.ts`              | Modify  |
| `src/core/loader.ts`                | Modify  |
| `src/components/ComponentAction.tsx` | **New** |
| `src/app.tsx`                       | Modify  |
| `test/component.test.ts`            | **New** |
| `test/metadata.test.ts`             | Modify  |
| `test/fixtures/component-repo/...`  | **New** |

## Verification

1. `bun test` — all existing tests still pass, new component tests pass
2. Manual: create a `.tsx` component action in `.xcli/actions/`, run `xcli`, select it, verify it renders inline
3. Manual: verify ESC returns to menu, and `exit()` callback works
4. Manual: verify `.tsx` without `// xcli:component true` still runs as subprocess
