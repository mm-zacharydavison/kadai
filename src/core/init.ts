import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SourceConfig } from "../types.ts";
import { generateConfigFile } from "./init-wizard.ts";

export async function initXcli(
  cwd: string,
  options?: {
    sources?: SourceConfig[];
    aiEnabled?: boolean;
  },
): Promise<string> {
  const xcliDir = join(cwd, ".xcli");
  const actionsDir = join(xcliDir, "actions");

  mkdirSync(actionsDir, { recursive: true });

  // Create a sample hello-world action
  const sampleAction = join(actionsDir, "hello.sh");
  const sampleFile = Bun.file(sampleAction);
  if (!(await sampleFile.exists())) {
    await Bun.write(
      sampleAction,
      `#!/bin/bash
# xcli:name Hello World
# xcli:emoji 👋
# xcli:description A sample action — edit or delete this file

echo "Hello from xcli!"
echo "Add your own scripts to .xcli/actions/ to get started."
`,
    );
  }

  // Write config.ts if sources or AI settings are provided
  if (options) {
    const configContent = generateConfigFile({
      sources: options.sources ?? [],
      aiEnabled: options.aiEnabled ?? true,
    });
    await Bun.write(join(xcliDir, "config.ts"), configContent);
  }

  return xcliDir;
}
