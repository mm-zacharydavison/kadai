# Plan: Fix userName in shared repo context

## Problem

`userName` in `.xcli/config.ts` has two issues:

1. **It's a real name, not a username.** It comes from `git config user.name` (e.g. `"Zachary Davison"`), which produces paths with spaces like `actions/@meetsmore/Zachary Davison`.
2. **It's baked into committed config.** In a shared repo, every collaborator gets the same person's name — whoever ran `xcli init`.

## Current usage

`userName` is only used in one place: `ShareScreen.tsx` calls `buildDefaultPath(org, userName)` to construct the default destination when sharing actions to a source repo. The result is a path like `actions/@org/userName`.

The intent is to namespace shared actions by contributor so they don't collide (e.g. `actions/@meetsmore/alice`, `actions/@meetsmore/bob`).

## Solution

**Derive the GitHub username at runtime** instead of storing it in config.

### Why GitHub username?

- It's a proper username (no spaces, unique identifier)
- It's already available via `git config user.name` → but that's a display name
- GitHub username can be fetched from `gh api user` or inferred from the git remote + SSH key
- Simplest reliable method: **parse the GitHub username from the remote URL** for SSH (`git@github.com:username/...`) or use `gh api user --jq .login`

### Changes

#### 1. `src/core/git-utils.ts` — Add `getGitHubUsername()`

```ts
export async function getGitHubUsername(): Promise<string | null> {
  // Try `gh` CLI first (most reliable, works for HTTPS too)
  try {
    const login = await Bun.$`gh api user --jq .login`.quiet().text();
    return login.trim() || null;
  } catch {
    // gh not installed or not authenticated
  }
  return null;
}
```

#### 2. `src/components/ShareScreen.tsx` — Use runtime username

Replace `config?.userName` with a runtime-fetched GitHub username:

- Call `getGitHubUsername()` in a `useEffect` on mount
- Fall back to `config?.userName` for backwards compatibility (existing configs still work)
- Use the result in `buildDefaultPath(org, username)`

#### 3. `src/core/init-wizard.ts` — Stop writing `userName` to config

- Remove `userName` from `GenerateConfigOptions`
- Remove the lines that write `userName: "..."` to the config file
- The `org` field stays (it's repo-specific, not user-specific)

#### 4. `src/components/InitWizard.tsx` — Stop fetching userName for config

- Remove the `getGitUserName()` call and `userNameRef`
- Stop passing `userName` to `generateConfigFile()`

#### 5. `src/types.ts` — Deprecate `userName` on `XcliConfig`

- Keep the field for backwards compatibility (old configs still have it)
- Update the doc comment to mark it as deprecated

#### 6. Update tests

- Init wizard tests: remove assertions about `userName` in generated config
- ShareScreen tests: mock `getGitHubUsername()` instead of relying on `config.userName`
- Add test for fallback when `gh` is unavailable

## Migration

- Existing `.xcli/config.ts` files with `userName` continue to work as a fallback
- New `xcli init` runs no longer write `userName`
- The runtime GitHub username takes priority when available

## File summary

| File                              | Change                                             |
|:----------------------------------|:---------------------------------------------------|
| `src/core/git-utils.ts`          | Add `getGitHubUsername()` using `gh api`           |
| `src/components/ShareScreen.tsx`  | Fetch username at runtime, fall back to config     |
| `src/core/init-wizard.ts`        | Remove `userName` from config generation           |
| `src/components/InitWizard.tsx`   | Stop fetching/passing `userName`                   |
| `src/types.ts`                   | Deprecate `userName` field                         |
| `test/init-wizard.test.ts`       | Update config generation assertions                |
| `test/ai/share-screen.test.ts`   | Mock `getGitHubUsername()`, update path assertions  |
