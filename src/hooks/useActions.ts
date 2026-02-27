import { join } from "node:path";
import { useEffect, useRef, useState } from "react";
import { loadConfig } from "../core/config.ts";
import { loadActions } from "../core/loader.ts";
import {
  loadCachedPlugins,
  loadPathPlugin,
  loadUserGlobalActions,
  pluginDisplayName,
  syncPlugins,
} from "../core/plugins.ts";
import type { Action, KadaiConfig, PluginSyncStatus } from "../types.ts";

interface UseActionsOptions {
  kadaiDir: string;
}

export function useActions({ kadaiDir }: UseActionsOptions) {
  const [actions, setActions] = useState<Action[]>([]);
  const [config, setConfig] = useState<KadaiConfig>({});
  const [loading, setLoading] = useState(true);
  const [pluginSyncStatuses, setPluginSyncStatuses] = useState<
    Map<string, PluginSyncStatus>
  >(new Map());
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig(kadaiDir);
      setConfig(cfg);

      const actionsDir = join(kadaiDir, cfg.actionsDir ?? "actions");
      const localActions = await loadActions(actionsDir);

      // Merge in all plugin sources synchronously (from cache/disk)
      let allActions = [...localActions];

      // 1. User-global actions (~/.kadai/actions/)
      const globalActions = await loadUserGlobalActions();
      allActions = [...allActions, ...globalActions];

      // 2. Path plugins (direct disk read, no cache)
      if (cfg.plugins) {
        for (const source of cfg.plugins) {
          if ("path" in source) {
            const pathActions = await loadPathPlugin(kadaiDir, source);
            allActions = [...allActions, ...pathActions];
          }
        }
      }

      // 3. Cached npm/github plugins
      if (cfg.plugins) {
        const cachedActions = await loadCachedPlugins(kadaiDir, cfg.plugins);
        allActions = [...allActions, ...cachedActions];
      }

      setActions(allActions);
      setLoading(false);

      // 4. Background sync for npm/github plugins
      if (cfg.plugins && cfg.plugins.length > 0) {
        // Initialize sync statuses for all syncable plugins
        const initialStatuses = new Map<string, PluginSyncStatus>();
        for (const source of cfg.plugins) {
          if (!("path" in source)) {
            initialStatuses.set(pluginDisplayName(source), "syncing");
          }
        }
        setPluginSyncStatuses(initialStatuses);

        syncPlugins(kadaiDir, cfg.plugins, {
          onPluginStatus: (name, status) => {
            setPluginSyncStatuses((prev) => {
              const next = new Map(prev);
              next.set(name, status);
              return next;
            });
          },
          onUpdate: (freshPluginActions) => {
            // Merge fresh plugin actions with local + path + global actions
            setActions((prev) => {
              // Keep all non-cached-plugin actions
              const nonCached = prev.filter(
                (a) =>
                  a.origin.type === "local" ||
                  (a.origin.type === "plugin" &&
                    (a.origin.pluginName === "~" ||
                      cfg.plugins?.some(
                        (p) => "path" in p && p.path === a.origin.pluginName,
                      ))),
              );
              return [...nonCached, ...freshPluginActions];
            });
          },
        });
      }
    })();
  }, [kadaiDir]);

  return { actions, actionsRef, config, loading, pluginSyncStatuses };
}
