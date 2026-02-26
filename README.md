<img width="1024" height="1024" alt="image" src="https://github.com/user-attachments/assets/daa548e6-5984-4cde-93d3-7c4684de639a" />

# kadai

A terminal UI for discovering and running project scripts. Drop scripts into `.kadai/actions/`, and kadai gives you a fuzzy-searchable menu to run them.

## Getting Started

<img width="950" height="205" alt="image" src="https://github.com/user-attachments/assets/b694bfaa-146b-41c7-a44c-d197c7cea08e" />

```bash
bunx kadai
```

On first run, kadai creates a `.kadai/` directory with a sample action and config file. Run it again to open the interactive menu.

### Directory Structure

```
.kadai/
├── config.ts          # Optional configuration (env vars, actions dir)
└── actions/           # Your scripts live here
    ├── hello.sh
    ├── deploy.ts
    └── database/      # Subdirectories become categories
        ├── reset.sh
        └── seed.py
```

## Features

### Supported Runtimes

| Extension          | Runtime  |
|--------------------|----------|
| `.sh`, `.bash`     | bash     |
| `.ts`, `.js`, `.mjs` | bun   |
| `.py`              | python   |

Shebangs are respected — if your script has `#!/usr/bin/env python3`, kadai uses that directly. Otherwise it finds the best available interpreter automatically (e.g. `uv run` before `python3` for `.py` files).

### Frontmatter

Add metadata as comments in the first 20 lines of any script:

```bash
#!/bin/bash
# kadai:name Deploy Staging
# kadai:emoji 🚀
# kadai:description Deploy the app to staging
# kadai:confirm true
```

For JS/TS, use `//` comments:

```typescript
// kadai:name Reset Database
// kadai:emoji 🗑️
// kadai:confirm true
```

| Key           | Type    | Description                                |
|---------------|---------|--------------------------------------------|
| `name`        | string  | Display name (inferred from filename if omitted) |
| `emoji`       | string  | Emoji prefix in menus                      |
| `description` | string  | Short description                          |
| `confirm`     | boolean | Require confirmation before running        |
| `hidden`      | boolean | Hide from menu (still runnable via CLI)    |
| `interactive` | boolean | Hand over the full terminal to the script  |

### Interactive Scripts

Scripts marked `interactive` get full terminal control — kadai exits its UI, runs the script with inherited stdio, then returns to the menu. Use this for scripts that need user input (readline prompts, password entry, etc.).

### Ink UI Actions (Planned)

`.tsx` files will be able to export an Ink component that renders directly inside kadai's UI, enabling rich interactive interfaces (forms, progress bars, tables) without spawning a subprocess.

### Config

`.kadai/config.ts` lets you set environment variables injected into all actions:

```typescript
export default {
  env: {
    DATABASE_URL: "postgres://localhost:5432/myapp",
    APP_ENV: "development",
  },
};
```

## CLI

```bash
kadai                    # Interactive menu
kadai list --json        # List actions as JSON
kadai list --json --all  # Include hidden actions
kadai run <action-id>    # Run an action directly
```

## AI

kadai is designed to work well with AI coding agents like Claude Code.

### How It Works

- `kadai list --json` gives agents a machine-readable list of available project actions
- `kadai run <action-id>` runs actions non-interactively (confirmation prompts auto-skip in non-TTY)
- Agents can discover what's available, then run the right action — no hardcoded commands

### Skill Installation

If your project uses Claude Code (has a `.claude/` directory or `CLAUDE.md`), kadai automatically creates a skill file at `.claude/skills/kadai/SKILL.md` on first run. This teaches Claude Code how to discover and run your project's actions.

The skill is non-user-invocable — Claude Code reads it automatically and uses kadai when relevant, without needing explicit prompts.
