import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ─── Init result ──────────────────────────────────────────────────

export interface InitResult {
  kadaiDir: string;
}

// ─── Config file generation ───────────────────────────────────────

export function generateConfigFile(): string {
  const lines = ['  // actionsDir: "actions",', "  // env: {},"];

  return `export default {\n${lines.join("\n")}\n};\n`;
}

// ─── File writing (used by InitWizard component) ─────────────────

export interface WriteInitFilesResult {
  sampleCreated: boolean;
  skillCreated: boolean;
}

export async function writeInitFiles(
  cwd: string,
): Promise<WriteInitFilesResult> {
  const kadaiDir = join(cwd, ".kadai");
  const actionsDir = join(kadaiDir, "actions");
  mkdirSync(actionsDir, { recursive: true });

  // Sample action
  const sampleAction = join(actionsDir, "hello.sh");
  const sampleFile = Bun.file(sampleAction);
  let sampleCreated = false;
  if (!(await sampleFile.exists())) {
    await Bun.write(
      sampleAction,
      `#!/bin/bash
# kadai:name Hello World
# kadai:emoji 👋
# kadai:description A sample action — edit or delete this file

echo "Hello from kadai!"
echo "Add your own scripts to .kadai/actions/ to get started."
`,
    );
    sampleCreated = true;
  }

  // Config file
  const configContent = generateConfigFile();
  const configPath = join(kadaiDir, "config.ts");
  await Bun.write(configPath, configContent);

  // Claude Code integration files
  const integration = await ensureClaudeIntegration(cwd);

  return { sampleCreated, skillCreated: integration.skillCreated };
}

// ─── Ensure Claude Code integration ──────────────────────────────

export interface EnsureResult {
  skillCreated: boolean;
  mcpConfigured: boolean;
}

/**
 * Ensure Claude Code skill file and MCP config exist if the project
 * uses Claude Code (has .claude dir or CLAUDE.md). Safe to call
 * repeatedly — skips files that already exist.
 */
export async function ensureClaudeIntegration(
  projectRoot: string,
): Promise<EnsureResult> {
  const hasClaudeDir = existsSync(join(projectRoot, ".claude"));
  const hasClaudeMd = existsSync(join(projectRoot, "CLAUDE.md"));

  if (!hasClaudeDir && !hasClaudeMd) {
    return { skillCreated: false, mcpConfigured: false };
  }

  const skillCreated = await ensureSkillFile(projectRoot);
  const mcpConfigured = await ensureMcpJsonEntry(projectRoot);

  return { skillCreated, mcpConfigured };
}

async function ensureSkillFile(projectRoot: string): Promise<boolean> {
  const skillDir = join(projectRoot, ".claude", "skills", "kadai");
  const skillPath = join(skillDir, "SKILL.md");
  if (await Bun.file(skillPath).exists()) {
    return false;
  }
  mkdirSync(skillDir, { recursive: true });
  await Bun.write(skillPath, generateSkillFile());
  return true;
}

async function ensureMcpJsonEntry(projectRoot: string): Promise<boolean> {
  const { ensureMcpConfig } = await import("./mcp.ts");
  return await ensureMcpConfig(projectRoot);
}

function generateSkillFile(): string {
  return `---
name: kadai
description: >-
  kadai is a script runner for this project. Discover available actions with
  kadai list --json, and run them with kadai run <action-id>.
user-invocable: false
---

# kadai — Project Script Runner

kadai manages and runs project-specific shell scripts stored in \`.kadai/actions/\`.

## Discovering Actions

\`\`\`bash
kadai list --json
\`\`\`

Returns a JSON array of available actions:

\`\`\`json
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
\`\`\`

Use \`--all\` to include hidden actions: \`kadai list --json --all\`

Always use \`kadai list --json\` for the current set of actions — do not hardcode action lists.

## Running Actions

\`\`\`bash
kadai run <action-id>
\`\`\`

Runs the action and streams stdout/stderr directly. The process exits with the action's exit code.
Confirmation prompts are automatically skipped in non-TTY environments.

### Examples

\`\`\`bash
kadai run hello
kadai run database/reset
\`\`\`

## Creating Actions

Create a script file in \`.kadai/actions/\`. Supported extensions: \`.sh\`, \`.bash\`, \`.ts\`, \`.js\`, \`.mjs\`, \`.py\`, \`.tsx\`.

Add metadata as comments in the first 20 lines using \`# kadai:<key> <value>\` (for shell/python) or \`// kadai:<key> <value>\` (for JS/TS):

\`\`\`bash
#!/bin/bash
# kadai:name Deploy Staging
# kadai:emoji 🚀
# kadai:description Deploy the app to the staging environment
# kadai:confirm true

echo "Deploying..."
\`\`\`

Available metadata keys:

| Key           | Description                                 |
|---------------|---------------------------------------------|
| \`name\`        | Display name in menus                       |
| \`emoji\`       | Emoji prefix                                |
| \`description\` | Short description                           |
| \`confirm\`     | Require confirmation before running (true/false) |
| \`hidden\`      | Hide from default listing (true/false)      |
| \`fullscreen\`  | Use alternate screen buffer for ink actions (true/false) |
| \`input\`       | Declare a user input (see below)            |

If \`name\` is omitted, it is inferred from the filename (e.g. \`deploy-staging.sh\` → "Deploy Staging").

## Declaring Inputs

Actions can declare inputs that are collected before the script runs. Use one \`kadai:input\` line per input:

\`\`\`
# kadai:input <name>[?] <type> "<prompt>" [sensitive]
\`\`\`

- \`name\` — identifier used for env var injection; no spaces
- \`?\` suffix — marks the input as optional (required by default)
- \`type\` — one of \`string\`, \`boolean\`, \`number\`
- \`"prompt"\` — text shown to the user (must be quoted)
- \`sensitive\` — optional flag: masks the value in the UI and excludes it from \`.last-action\` so it is never persisted and always re-prompted on \`--rerun\`

Use \`sensitive\` for passwords, tokens, and any value that should not be stored on disk.

### Example

\`\`\`bash
#!/bin/bash
# kadai:name Reset Database
# kadai:description Drops and recreates the dev database
# kadai:confirm true
# kadai:input database_name string "Which database?"
# kadai:input drop_data? boolean "Also drop all data?"
# kadai:input db_password string "Database password?" sensitive

echo "Resetting \${KADAI_INPUT_DATABASE_NAME}..."
\`\`\`

### How inputs are injected

Each declared input value is provided to the script two ways:

1. **Env var**: \`KADAI_INPUT_<NAME>\` (uppercased) — always set
2. **Stdin**: values prepended in declaration order — so \`read\`, \`input()\`, \`gets\` etc. receive them automatically

This means you can write interactive scripts normally and they just work:

\`\`\`bash
read -p "Which database? " DB   # receives the collected value from stdin
echo "Resetting \$DB..."
\`\`\`

### How inputs surface in each context

| Context | Behavior |
|---------|----------|
| Interactive menu | Pre-run form collects values before launching the script |
| \`kadai run <id>\` | No collection — pass values via \`KADAI_INPUT_*\` env vars if needed |
| \`kadai --rerun\` | Previously collected values are replayed automatically |
| MCP tool call | Declared inputs become typed tool parameters (string/boolean/number) |

### When authoring actions with inputs

- Declare all interactive prompts as \`kadai:input\` if you want them to work via MCP or \`--rerun\`
- Use \`?\` to mark optional inputs that have sensible defaults in the script
- Use \`sensitive\` for any input that is a password, token, or secret — the value will not be saved to disk and will be re-prompted on \`--rerun\`
- Prefer env var access (\`\$KADAI_INPUT_NAME\`) for clarity; stdin fallthrough is a convenience
- Actions with undeclared \`read\` calls will still work interactively, but those prompts won't be surfaced to MCP clients

Organize actions into categories using subdirectories:

\`\`\`
.kadai/actions/
  hello.sh              → id: "hello"
  database/
    migrate.sh          → id: "database/migrate"
    reset.ts            → id: "database/reset"
\`\`\`
`;
}
