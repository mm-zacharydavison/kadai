import { join } from "node:path";
import type { KadaiConfig } from "../types.ts";

const DEFAULT_CONFIG: KadaiConfig = {
  actionsDir: "actions",
  env: {},
};

export async function loadConfig(kadaiDir: string): Promise<KadaiConfig> {
  const configPath = join(kadaiDir, "config.ts");
  const configFile = Bun.file(configPath);

  if (!(await configFile.exists())) {
    return { ...DEFAULT_CONFIG };
  }

  const mod = await import(configPath);
  const userConfig: KadaiConfig = mod.default ?? mod;

  return {
    actionsDir: userConfig.actionsDir ?? DEFAULT_CONFIG.actionsDir,
    env: userConfig.env ?? DEFAULT_CONFIG.env,
    plugins: userConfig.plugins,
  };
}
