import { join } from "node:path";
import type { XcliConfig } from "../types.ts";

const DEFAULT_CONFIG: XcliConfig = {
  actionsDir: "actions",
  env: {},
};

export async function loadConfig(xcliDir: string): Promise<XcliConfig> {
  const configPath = join(xcliDir, "config.ts");
  const configFile = Bun.file(configPath);

  if (!(await configFile.exists())) {
    return { ...DEFAULT_CONFIG };
  }

  const mod = await import(configPath);
  const userConfig: XcliConfig = mod.default ?? mod;

  return {
    actionsDir: userConfig.actionsDir ?? DEFAULT_CONFIG.actionsDir,
    env: userConfig.env ?? DEFAULT_CONFIG.env,
    hooks: userConfig.hooks,
    sources: userConfig.sources,
  };
}
