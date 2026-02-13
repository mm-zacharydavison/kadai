# UI Refactor Plan

Extract reusable primitives from InitWizard (913 lines) and ShareScreen (640 lines) to reduce duplication and simplify business logic.

## Problem

Three patterns are copy-pasted across multiple components:

1. **State+ref sync** — Every piece of state used inside `useInput` needs a matching ref. Each one requires a `useState`, a `useRef`, and an `update*` wrapper. InitWizard has **13** of these pairs; ShareScreen has **6**.
2. **Selection lists** — Arrow/vim navigation + cursor rendering appears in InitWizard (5 phases), ShareScreen (2 steps), app.tsx (MenuList), and useKeyboard.
3. **Text input** — Backspace/append/submit/escape handling is duplicated in InitWizard (`enter-repo`, `enter-reviewer`, `choose-reviewer` search), ShareScreen (`pick-path` custom field), and useKeyboard (menu search).

Secondary issues:
- ActionOutput and ShareScreen duplicate the same `readStream` + `runAction` effect.
- Multi-select (choose-reviewer) is inlined in InitWizard with no reuse path.
- No shared "loading spinner with message" pattern despite 5 uses.

## Available Ink Packages

Before building custom primitives, we surveyed the Ink ecosystem. All packages below are by Vadim Demedes (the Ink author) and compatible with our Ink 6 / React 19 setup.

### `@inkjs/ui@2.0.0` — official UI kit

One package that covers most of our needs:

| Component      | Replaces                                                  |
| -------------- | --------------------------------------------------------- |
| `Select`       | InitWizard's `SelectionView`, ShareScreen's `pick-source` |
| `MultiSelect`  | InitWizard's `choose-reviewer` checkbox list              |
| `TextInput`    | InitWizard's `enter-repo`/`enter-reviewer`, ShareScreen's custom path field |
| `Spinner`      | All 5 `<Spinner type="dots" />` + label patterns          |
| `ConfirmInput` | app.tsx confirm screen                                    |

**API style:** Uncontrolled-first (`defaultValue` + `onChange`/`onSubmit` callbacks). Components own their own keyboard handling internally — no `useInput` boilerplate needed from us.

**Trade-offs:**
- Components own their input handling, so we lose direct control over keystroke routing. This is actually a *win* for wizards — it eliminates the giant `useInput` handlers entirely.
- No built-in vim `j`/`k` navigation. We'd lose that in wizard screens (the main menu in `useKeyboard` would keep it since that's custom).
- `Select` and `MultiSelect` use `isDisabled` rather than `isFocused`/`isActive` for gating — we'd need to verify this works for phase-switching in wizards.

### Recommendation: Use `@inkjs/ui` for everything

One package, one API style, less to think about. Accept the uncontrolled API and adapt our code to work with callbacks instead of refs.

| Need              | Use                    | Replaces                                              |
| ----------------- | ---------------------- | ----------------------------------------------------- |
| **Select lists**  | `@inkjs/ui` `Select`   | InitWizard `SelectionView`, ShareScreen `pick-source`, app.tsx `MenuList` |
| **Text input**    | `@inkjs/ui` `TextInput`| InitWizard `enter-repo`/`enter-reviewer`, ShareScreen custom path, menu search |
| **Multi-select**  | `@inkjs/ui` `MultiSelect` | InitWizard `choose-reviewer`                       |
| **Spinner**       | `@inkjs/ui` `Spinner`  | All 5 manual `<Spinner type="dots" /> Label` patterns (replaces `ink-spinner`) |
| **Confirm**       | `@inkjs/ui` `ConfirmInput` | app.tsx confirm screen                            |

**What we give up:**
- Vim `j`/`k` navigation in wizard screens (main menu keeps it via custom `useKeyboard`)
- Controlled `value` prop on text inputs — we adapt to `defaultValue` + `onChange`/`onSubmit` callbacks
- Custom indicator/item components on select — `@inkjs/ui` `Select` may have less customization than `ink-select-input`

**What we gain:**
- Single dependency for all UI primitives
- Consistent uncontrolled API everywhere
- Components own their own input handling — the giant `useInput` handlers in InitWizard and ShareScreen largely disappear
- Built-in theming if we ever want it

## Proposed Changes

### 1. `useRefState<T>(initial)` hook — still needed

`@inkjs/ui` components own their own input state, but we still need refs for phase/step tracking and collected wizard answers (read by async callbacks).

```ts
// src/hooks/useRefState.ts
function useRefState<T>(initial: T): [T, React.MutableRefObject<T>, (v: T) => void]
```

| File            | Pairs eliminated |
| --------------- | ---------------- |
| InitWizard.tsx  | ~8 (down from 13 — select/text/multiselect state moves into `@inkjs/ui`) |
| ShareScreen.tsx | ~4 (down from 6) |
| useSearch.ts    | 3                |
| **Total**       | **~15**          |

**Effort:** Small. Pure extraction, no behavior change.

---

### 2. Replace selection lists with `@inkjs/ui` `Select`

**InitWizard** — 5 selection phases (`choose-location`, `choose-repo-setup`, `choose-org`, `choose-push-strategy`, `choose-ai`) plus `create-failed` currently use a hand-rolled `SelectionView` + manual `useInput` arrow handling.

Replace with:
```tsx
import { Select } from "@inkjs/ui";

// In choose-location phase:
<Select
  options={locationOptions}
  onChange={(value) => handleSelection("choose-location", value)}
/>
```

This eliminates:
- The entire `arrowPhases` block in `useInput` (~30 lines)
- The `selectedIndex` / `selectedIndexRef` / `updateIndex` boilerplate for these phases
- The `SelectionView` sub-component (~25 lines)
- All inline list rendering in `create-failed`

**ShareScreen** — `pick-source` and the preset rows of `pick-path` become `<Select>` instances. The custom text row in `pick-path` needs special handling: a `<Select>` for the preset paths with an extra "Custom..." option, which transitions to a `<TextInput>` when chosen.

**app.tsx MenuList** — This is the richest list (emoji, description, source badge, isNew marker). `@inkjs/ui` `Select` provides `options` with `label` and `value`. We'd format the label string to include emoji/description, or investigate whether `Select` supports custom rendering. If not, MenuList stays as a custom component — it's the main menu and benefits from full control.

**Effort:** Medium. InitWizard and ShareScreen are mechanical. MenuList may stay custom.

---

### 3. Replace text inputs with `@inkjs/ui` `TextInput`

**InitWizard** — `enter-repo` and `enter-reviewer` phases become:
```tsx
import { TextInput } from "@inkjs/ui";

// In enter-repo phase:
<TextInput
  placeholder="org/repo-name"
  onSubmit={handleRepoSubmit}
/>
```

This eliminates:
- All backspace/append/printable-char handling in `useInput` for these phases (~50 lines)
- The manual cursor rendering (`> {value}█`)
- The `repoInput`/`repoInputRef`/`updateRepoInput` state triplets

**ShareScreen** — `pick-path` custom field becomes a `<TextInput>`.

**useKeyboard / app.tsx search** — Replace the manual search input with `<TextInput>`. The `onChange` callback syncs the query for fuzzy filtering. This deletes ~40 lines of search keystroke handling from `useKeyboard` and improves UX (cursor position nav, paste support come free).

**Effort:** Medium.

---

### 4. Replace choose-reviewer with `@inkjs/ui` `MultiSelect`

The `choose-reviewer` phase in InitWizard is ~100 lines of input + rendering for checkbox toggling, fuzzy filtering, and a "Done" row.

Replace with:
```tsx
import { MultiSelect } from "@inkjs/ui";

<MultiSelect
  options={reviewerOptions.map(r => ({ label: r.label, value: r.value }))}
  onSubmit={(selected) => {
    updateShareConfig({ ...shareConfigRef.current, strategy: "pr", reviewers: selected });
    setPhase("choose-ai");
  }}
/>
```

This eliminates:
- `selectedReviewersRef`, `reviewerSearch`, `toggleReviewer`, `getFilteredReviewerOptions` (~60 lines of state + logic)
- The checkbox rendering block (~25 lines)
- The multi-select input handling in `useInput` (~55 lines)

**Caveat:** `@inkjs/ui` MultiSelect may not have built-in fuzzy search filtering. If not, we accept that trade-off — the reviewer list is typically small enough that filtering isn't critical.

**Effort:** Medium. Self-contained to one phase.

---

### 5. Replace confirm screen with `@inkjs/ui` `ConfirmInput`

The confirm screen in app.tsx is simple but the keyboard handling lives in `useKeyboard`. Replace with:
```tsx
import { ConfirmInput } from "@inkjs/ui";

<ConfirmInput
  defaultChoice="confirm"
  onConfirm={() => pushScreen({ type: "output", actionId })}
  onCancel={() => popScreen()}
/>
```

Removes the confirm branch from `useKeyboard` (~10 lines).

**Effort:** Small.

---

### 6. Replace `ink-spinner` with `@inkjs/ui` `Spinner`

`@inkjs/ui` Spinner has a built-in `label` prop, which is cleaner than the current pattern of composing `<Spinner type="dots" />` with adjacent `<Text>`.

**Before** (repeated 5 times):
```tsx
<Text><Spinner type="dots" /> Fetching GitHub orgs...</Text>
```

**After:**
```tsx
<Spinner label="Fetching GitHub orgs..." />
```

Remove `ink-spinner` from deps after migration.

**Effort:** Small. Find-and-replace.

---

### 7. `useActionRunner()` hook — still needed

No package exists for this. Extract the duplicated `readStream` + `runAction` effect.

```ts
// src/hooks/useActionRunner.ts
function useActionRunner(options: {
  action: Action | null;
  cwd: string;
  config?: XcliConfig;
  enabled?: boolean;
}): {
  lines: string[];
  exitCode: number | null;
  running: boolean;
}
```

Deduplicates `ActionOutput.tsx:18–54` and `ShareScreen.tsx:161–221`.

**Effort:** Small. Pure extraction.

---

### 8. Phase sub-components for wizards — still recommended

With `@inkjs/ui` components owning their own input handling, the monolithic `useInput` in InitWizard and ShareScreen largely disappears. The parent still orchestrates phase transitions and collected state.

Breaking each phase into a sub-component keeps things clean:
```tsx
function InitWizard({ cwd, deps, onDone }) {
  const [phase, phaseRef, setPhase] = useRefState<Phase>("choose-location");
  const collected = useRef<CollectedAnswers>({});

  switch (phase) {
    case "choose-location":
      return <ChooseLocationPhase onNext={(choice) => { ... }} />;
    case "enter-repo":
      return <EnterRepoPhase deps={deps} onNext={(repo) => { ... }} onBack={() => setPhase("choose-repo-setup")} />;
    case "choose-reviewer":
      return <ChooseReviewerPhase options={reviewerOptions} onNext={(reviewers) => { ... }} />;
    // ...
  }
}
```

Each sub-component is <40 lines, composes an `@inkjs/ui` component + one or two callbacks. The parent is a clean state machine with no `useInput` at all.

**Effort:** Large, but much easier now that `@inkjs/ui` handles all input. The `useInput` handler disappears entirely from wizards.

---

## Implementation Order

```
Phase 1 — no-risk extractions:
  1. bun add @inkjs/ui
  2. useRefState hook
  3. useActionRunner hook

Phase 2 — swap in @inkjs/ui components (one at a time, test after each):
  4. Select → InitWizard selection phases
  5. Select → ShareScreen pick-source/pick-path
  6. TextInput → InitWizard enter-repo/enter-reviewer
  7. TextInput → ShareScreen pick-path custom field
  8. TextInput → app.tsx search bar (replacing useKeyboard search mode)
  9. MultiSelect → InitWizard choose-reviewer
 10. ConfirmInput → app.tsx confirm screen
 11. Spinner → replace all ink-spinner usages, then bun remove ink-spinner

Phase 3 — structural cleanup:
 12. Break InitWizard into phase sub-components
 13. Break ShareScreen into step sub-components
 14. Slim down useKeyboard (remove search, confirm, and list nav that @inkjs/ui now owns)
```

Each step in Phase 2 is independently shippable and testable. If `@inkjs/ui` doesn't fit a specific use case, we keep the manual code for that spot.

**Open question:** app.tsx `MenuList` may stay custom if `@inkjs/ui` `Select` doesn't support the rich rendering we need (emoji, description, source badge, isNew marker). Evaluate during step 5 — if `Select` can handle it, great; if not, MenuList stays as-is.

## What's Custom vs. Package

Everything from the original plan's custom components is now **replaced by `@inkjs/ui`**:

| Original proposal         | Replaced by              |
| ------------------------- | ------------------------ |
| `<SelectList>` component  | `@inkjs/ui` `Select`     |
| `useListNav` hook         | `@inkjs/ui` `Select` (owns its own navigation) |
| `useTextInput` hook       | `@inkjs/ui` `TextInput`  |
| `<TextInput>` component   | `@inkjs/ui` `TextInput`  |
| `<MultiSelect>` component | `@inkjs/ui` `MultiSelect`|
| `useMultiSelect` hook     | `@inkjs/ui` `MultiSelect`|
| `ink-spinner` usage       | `@inkjs/ui` `Spinner`    |

Still needed (no package covers them):

| Custom extraction    | Why                                                      |
| -------------------- | -------------------------------------------------------- |
| `useRefState`        | Generic state+ref sync, not UI-specific                  |
| `useActionRunner`    | Domain-specific process lifecycle, no package for this   |
| Phase sub-components | Structural decomposition, not a library concern          |

## Expected Impact

| File            | Current lines | Estimated after |
| --------------- | ------------- | --------------- |
| InitWizard.tsx  | 913           | ~250 (parent state machine + phase sub-components) |
| ShareScreen.tsx | 640           | ~200            |
| useKeyboard.ts  | 259           | ~120 (menu-only, no search/confirm/list boilerplate) |
| app.tsx         | 328           | ~250            |

Dependencies: +1 (`@inkjs/ui`), -1 (`ink-spinner`), net zero.

New custom files: ~2 (useRefState, useActionRunner), each under 40 lines.

Net: ~1,000 lines of manual UI handling replaced by ~300 lines of `@inkjs/ui` composition + callbacks. The remaining code is almost entirely business logic (phase transitions, API calls, data collection).
