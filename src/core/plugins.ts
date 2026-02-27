import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type {
  Action,
  GithubPluginSource,
  NpmPluginSource,
  PluginMeta,
  PluginSource,
  PluginSyncStatus,
} from "../types.ts";
import { checkGithubUpdate, fetchGithubPlugin } from "./fetchers/github.ts";
import { checkNpmUpdate, fetchNpmPlugin } from "./fetchers/npm.ts";
import { loadActions } from "./loader.ts";
import { resolvePM } from "./pm.ts";

/**
 * Ensure the plugin cache directory exists at `.kadai/.cache/plugins/`
 * and that `.kadai/.cache/.gitignore` contains "*".
 */
export async function ensurePluginCacheDir(kadaiDir: string): Promise<string> {
  const cacheDir = join(kadaiDir, ".cache", "plugins");
  await mkdir(cacheDir, { recursive: true });

  const gitignorePath = join(kadaiDir, ".cache", ".gitignore");
  const gitignoreFile = Bun.file(gitignorePath);
  if (!(await gitignoreFile.exists())) {
    await Bun.write(gitignorePath, "*\n");
  }

  return cacheDir;
}

/**
 * Deterministic cache directory name from a plugin source.
 * Scoped npm names use `--` in place of `/`.
 *
 * @example cacheKeyFor({ npm: "@zdavison/claude-tools", version: "1.2.0" })
 * // → "npm/@zdavison--claude-tools@1.2.0"
 *
 * @example cacheKeyFor({ github: "zdavison/shared", ref: "main" })
 * // → "github/zdavison--shared@main"
 */
export function cacheKeyFor(
  source: NpmPluginSource | GithubPluginSource,
): string {
  if ("npm" in source) {
    const name = source.npm.replace("/", "--");
    const version = source.version ?? "latest";
    return `npm/${name}@${version}`;
  }

  const name = source.github.replace("/", "--");
  const ref = source.ref ?? "main";
  return `github/${name}@${ref}`;
}

/**
 * Display name for a plugin source, used in menus and logs.
 *
 * @example pluginDisplayName({ npm: "@zdavison/claude-tools" }) → "@zdavison/claude-tools"
 * @example pluginDisplayName({ github: "zdavison/shared" }) → "zdavison/shared"
 * @example pluginDisplayName({ path: "../shared" }) → "../shared"
 */
export function pluginDisplayName(source: PluginSource): string {
  if ("npm" in source) return source.npm;
  if ("github" in source) return source.github;
  return source.path;
}

/** Read `.plugin-meta.json` from a cache directory. Returns null if missing or invalid. */
export async function readPluginMeta(
  cacheDir: string,
): Promise<PluginMeta | null> {
  try {
    const file = Bun.file(join(cacheDir, ".plugin-meta.json"));
    if (!(await file.exists())) return null;
    return await file.json();
  } catch {
    return null;
  }
}

/** Write `.plugin-meta.json` to a cache directory. */
export async function writePluginMeta(
  cacheDir: string,
  meta: PluginMeta,
): Promise<void> {
  await Bun.write(
    join(cacheDir, ".plugin-meta.json"),
    JSON.stringify(meta, null, 2),
  );
}

/**
 * Load actions from cached npm/github plugins.
 * Scans the `.kadai/.cache/plugins/` directory for each configured plugin.
 * Actions are tagged with the plugin's origin and prefixed with the plugin name as a category.
 */
export async function loadCachedPlugins(
  kadaiDir: string,
  plugins: PluginSource[],
): Promise<Action[]> {
  const allActions: Action[] = [];
  const cacheBase = join(kadaiDir, ".cache", "plugins");

  for (const source of plugins) {
    // Path plugins don't use the cache
    if ("path" in source) continue;

    const key = cacheKeyFor(source);
    const pluginCacheDir = join(cacheBase, key);
    const actionsDir = join(pluginCacheDir, "actions");

    if (!existsSync(actionsDir)) continue;

    const name = pluginDisplayName(source);
    const origin = { type: "plugin" as const, pluginName: name };
    const actions = await loadActions(actionsDir, origin);

    // Prefix categories and IDs with the plugin name
    for (const action of actions) {
      action.category = [name, ...action.category];
      action.id = `${name}/${action.id}`;
    }

    allActions.push(...actions);
  }

  return allActions;
}

/**
 * Install dependencies for a plugin if it has a package.json.
 * Uses resolvePM() to find the appropriate package manager.
 */
export async function installPluginDeps(pluginDir: string): Promise<void> {
  const pkgJsonPath = join(pluginDir, "package.json");
  if (!existsSync(pkgJsonPath)) return;

  const pm = await resolvePM(pluginDir);
  const proc = Bun.spawn(pm.install, {
    cwd: pluginDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Failed to install plugin dependencies in ${pluginDir}: ${stderr.trim()}`,
    );
  }
}

interface SyncCallbacks {
  onPluginStatus: (pluginName: string, status: PluginSyncStatus) => void;
  onUpdate: (actions: Action[]) => void;
}

/**
 * Sync a single npm or github plugin:
 * 1. Check if update is available
 * 2. Fetch if needed
 * 3. Install dependencies
 * 4. Write meta
 */
async function syncPlugin(
  kadaiDir: string,
  source: NpmPluginSource | GithubPluginSource,
): Promise<void> {
  const cacheBase = await ensurePluginCacheDir(kadaiDir);
  const key = cacheKeyFor(source);
  const pluginCacheDir = join(cacheBase, key);
  const meta = await readPluginMeta(pluginCacheDir);

  // Check if update needed
  if (meta) {
    let needsUpdate = false;
    if ("npm" in source) {
      needsUpdate = await checkNpmUpdate(source, meta.resolvedVersion);
    } else {
      needsUpdate = await checkGithubUpdate(source, meta.resolvedVersion);
    }
    if (!needsUpdate) return;
  }

  // Clean and re-fetch
  await rm(pluginCacheDir, { recursive: true, force: true });
  await mkdir(pluginCacheDir, { recursive: true });

  let resolvedVersion: string;
  if ("npm" in source) {
    const result = await fetchNpmPlugin(source, pluginCacheDir);
    resolvedVersion = result.resolvedVersion;
  } else {
    const result = await fetchGithubPlugin(source, pluginCacheDir);
    resolvedVersion = result.resolvedVersion;
  }

  // Install dependencies
  await installPluginDeps(pluginCacheDir);

  // Write meta
  await writePluginMeta(pluginCacheDir, {
    fetchedAt: new Date().toISOString(),
    source,
    resolvedVersion,
  });
}

/**
 * Background sync all npm/github plugins concurrently.
 * Reports per-plugin status via callbacks.
 * Path plugins are skipped (they load directly from disk).
 */
export async function syncPlugins(
  kadaiDir: string,
  plugins: PluginSource[],
  callbacks: SyncCallbacks,
): Promise<void> {
  const syncable = plugins.filter(
    (p): p is NpmPluginSource | GithubPluginSource => !("path" in p),
  );

  const SYNC_TIMEOUT_MS = 60_000;

  await Promise.allSettled(
    syncable.map(async (source) => {
      const name = pluginDisplayName(source);
      callbacks.onPluginStatus(name, "syncing");
      try {
        await Promise.race([
          syncPlugin(kadaiDir, source),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Sync timeout for ${name}`)),
              SYNC_TIMEOUT_MS,
            ),
          ),
        ]);
        callbacks.onPluginStatus(name, "done");
      } catch {
        callbacks.onPluginStatus(name, "error");
      }
    }),
  );

  // After all syncs complete, reload cached actions and call onUpdate
  const allActions = await loadCachedPlugins(kadaiDir, plugins);
  callbacks.onUpdate(allActions);
}

/**
 * Load actions from a path plugin.
 * Relative paths are resolved relative to the kadaiDir.
 * Returns empty array if the path doesn't exist.
 */
export async function loadPathPlugin(
  kadaiDir: string,
  source: { path: string },
): Promise<Action[]> {
  const pluginRoot = isAbsolute(source.path)
    ? source.path
    : resolve(kadaiDir, source.path);
  const actionsDir = join(pluginRoot, "actions");

  if (!existsSync(actionsDir)) return [];

  const name = source.path;
  const origin = { type: "plugin" as const, pluginName: name };
  const actions = await loadActions(actionsDir, origin);

  // Prefix categories and IDs with the plugin display name
  for (const action of actions) {
    action.category = [name, ...action.category];
    action.id = `${name}/${action.id}`;
  }

  return actions;
}

/**
 * Load actions from the user-global ~/.kadai/actions/ directory.
 * Returns empty array if the directory doesn't exist.
 */
export async function loadUserGlobalActions(): Promise<Action[]> {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!homeDir) return [];

  const actionsDir = join(homeDir, ".kadai", "actions");
  if (!existsSync(actionsDir)) return [];

  const origin = { type: "plugin" as const, pluginName: "~" };
  const actions = await loadActions(actionsDir, origin);

  // Prefix categories and IDs with "~"
  for (const action of actions) {
    action.category = ["~", ...action.category];
    action.id = `~/${action.id}`;
  }

  return actions;
}
