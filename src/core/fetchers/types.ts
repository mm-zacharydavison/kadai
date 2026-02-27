import type { PluginSource } from "../../types.ts";

export interface FetchResult {
  /** Exact resolved version (npm semver) or commit SHA (github) */
  resolvedVersion: string;
}

export interface PluginFetcher<T extends PluginSource> {
  /** Fetch the plugin into destDir. Returns resolved version info. */
  fetch(source: T, destDir: string): Promise<FetchResult>;
  /** Check if a newer version is available without downloading. */
  checkForUpdate(source: T, currentVersion: string): Promise<boolean>;
}
