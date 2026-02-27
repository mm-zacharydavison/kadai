/**
 * Dependencies that kadai shares with ink actions at runtime.
 *
 * These packages are kept external in the bundle (build.ts) so that actions
 * dynamically imported via `import()` resolve the same module instances —
 * preventing the dual-React-instance problem that breaks hooks.
 *
 * The runtime resolver (registerSharedDeps) uses this list to redirect
 * action imports to kadai's own copies, so actions in other projects can
 * `import { Box } from "ink"` without installing ink themselves.
 *
 * Add new UI dependencies here — both the bundler and the resolver pick them up.
 */
export const SHARED_DEPS = ["ink", "react", "@inkjs/ui"] as const;

/**
 * Registers a Bun plugin that resolves shared UI dependencies to kadai's own
 * copies. Must be called before any dynamic `import()` of action files.
 */
export function registerSharedDeps(): void {
  const escaped = SHARED_DEPS.map((d) =>
    d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const filter = new RegExp(`^(${escaped.join("|")})(/.*)?$`);

  Bun.plugin({
    name: "kadai-shared-deps",
    setup(build) {
      build.onResolve({ filter }, (args) => {
        try {
          // require.resolve from kadai's own context always finds kadai's
          // node_modules, regardless of where the importing file is located.
          return { path: require.resolve(args.path) };
        } catch {
          return undefined;
        }
      });
    },
  });
}
