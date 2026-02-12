# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests
bun test test/loader.test.ts  # Run a single test file
bun run check            # TypeScript type-check + Biome lint
bun run lint             # Biome lint only
bun run lint:fix         # Biome auto-fix
bun src/cli.tsx          # Run the CLI locally
```

## What This Project Is

xcli is an interactive terminal tool for discovering and running shell scripts stored in `.xcli/actions/`. It provides a menu-driven UI with fuzzy search, supports multiple script runtimes (bash, TypeScript, Python, JS), and can load actions from external GitHub repos. It also integrates with Claude Code for AI-powered action generation.

## Architecture

**Entry point**: `src/cli.tsx` — finds/initializes `.xcli` dir, resolves git context, then enters a main loop alternating between Ink (React terminal UI) sessions and Claude Code handover sessions for AI generation.

**Core modules** (`src/core/`):
- `loader.ts` — Recursively scans `.xcli/actions/` for scripts, extracts metadata, builds action list
- `runner.ts` — Executes actions via `Bun.spawn()` with three-tier command resolution: shebang → runtime chain → fallback
- `config.ts` — Loads `.xcli/config.ts` (actionsDir, env, hooks, sources)
- `sources.ts` — Caches external action sources under `.xcli/.cache/sources/`, loads cached instantly, refreshes in background
- `fetcher.ts` — `SourceFetcher` interface with `GitFetcher` impl (shallow clone → atomic move)
- `metadata.ts` — Parses comment frontmatter (`# xcli:name`, `// xcli:emoji`, etc.)
- `git-utils.ts` — Parses GitHub remotes, detects repo identity, gets git user

**AI module** (`src/ai/`):
- `generate.ts` — Snapshots actions dir, spawns Claude Code, diffs to find new actions
- `prompt.ts` — Builds system prompt with xcli conventions and existing action listing
- `provider.ts` — `AIProvider` interface + `ClaudeCodeProvider` implementation
- `share.ts` — Copies generated actions to external source repos, commits, pushes

**UI layer** (`src/app.tsx` + `src/components/` + `src/hooks/`):
- React/Ink terminal app with screen stack navigation (menu → confirm → output → share)
- Hooks: `useActions` (load/refresh), `useNavigation` (screen stack), `useSearch` (fuzzy search via fuzzysort), `useKeyboard` (input handling)
- Terminal control handover pattern: Ink unmounts → Claude Code spawns → Ink remounts with results

**Types**: `src/types.ts` — All shared interfaces (`Action`, `Screen`, `XcliConfig`, `GenerationResult`, etc.)

## Testing

Tests use `bun:test` with `ink-testing-library` for component tests. `test/harness.ts` provides a CLI spawning harness for integration tests. Fixture repos live in `test/fixtures/`.

## Code Style

- Biome for formatting (2-space indent, double quotes) and linting
- TypeScript strict mode, JSX with automatic React runtime
- Bun as sole runtime — no Node.js, no express, no webpack
