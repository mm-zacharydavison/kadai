---
name: kadai
description: >-
  kadai is a script runner for this project. Discover available actions with
  kadai list --json, and run them with kadai run <action-id>.
user-invocable: false
---

# kadai — Project Script Runner

kadai manages and runs project-specific shell scripts stored in `.kadai/actions/`.

## Discovering Actions

```bash
kadai list --json
```

Returns a JSON array of available actions:

```json
[
  {
    "id": "database/reset",
    "name": "Reset Database",
    "emoji": "🗑️",
    "description": "Drop and recreate the dev database",
    "category": ["database"],
    "runtime": "bash",
    "confirm": true
  }
]
```

Use `--all` to include hidden actions: `kadai list --json --all`

Always use `kadai list --json` for the current set of actions — do not hardcode action lists.

## Running Actions

```bash
kadai run <action-id>
```

Runs the action and streams stdout/stderr directly. The process exits with the action's exit code.
Confirmation prompts are automatically skipped in non-TTY environments.

### Examples

```bash
kadai run hello
kadai run database/reset
```
