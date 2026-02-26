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

  // Claude Code skill file — only if the repo uses Claude Code
  let skillCreated = false;
  const hasClaudeDir = existsSync(join(cwd, ".claude"));
  const hasClaudeMd = existsSync(join(cwd, "CLAUDE.md"));
  if (hasClaudeDir || hasClaudeMd) {
    const skillDir = join(cwd, ".claude", "skills", "kadai");
    const skillPath = join(skillDir, "SKILL.md");
    if (!(await Bun.file(skillPath).exists())) {
      mkdirSync(skillDir, { recursive: true });
      await Bun.write(skillPath, generateSkillFile());
      skillCreated = true;
    }
  }

  return { sampleCreated, skillCreated };
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

Create a script file in \`.kadai/actions/\`. Supported extensions: \`.sh\`, \`.bash\`, \`.ts\`, \`.js\`, \`.mjs\`, \`.py\`.

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

If \`name\` is omitted, it is inferred from the filename (e.g. \`deploy-staging.sh\` → "Deploy Staging").

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
