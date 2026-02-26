import { join } from "node:path";
import { useEffect, useRef, useState } from "react";
import { loadConfig } from "../core/config.ts";
import { loadActions } from "../core/loader.ts";
import type { Action, KadaiConfig } from "../types.ts";

interface UseActionsOptions {
  kadaiDir: string;
}

export function useActions({ kadaiDir }: UseActionsOptions) {
  const [actions, setActions] = useState<Action[]>([]);
  const [config, setConfig] = useState<KadaiConfig>({});
  const [loading, setLoading] = useState(true);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig(kadaiDir);
      setConfig(cfg);

      const actionsDir = join(kadaiDir, cfg.actionsDir ?? "actions");
      const localActions = await loadActions(actionsDir);

      setActions(localActions);
      setLoading(false);
    })();
  }, [kadaiDir]);

  return { actions, actionsRef, config, loading };
}
