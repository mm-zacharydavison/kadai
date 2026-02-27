import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Action, KadaiConfig } from "../types.ts";
import { loadConfig } from "./config.ts";
import { loadActions } from "./loader.ts";
import {
  loadCachedPlugins,
  loadPathPlugin,
  loadUserGlobalActions,
} from "./plugins.ts";
import { resolveCommand } from "./runner.ts";

/**
 * Determine the command+args needed to re-invoke `kadai mcp`.
 *
 * When kadai is installed as a package, `process.argv[1]` points to the
 * installed bin (e.g. `…/node_modules/.bin/kadai` or a global path) and we
 * can use `bunx kadai mcp`.
 *
 * When running from source (`bun src/cli.tsx mcp`), `process.argv[1]` is a
 * `.ts`/`.tsx` file, so we emit `bun <absolute-path> mcp` instead.
 */
function resolveInvocationCommand(): {
  command: string;
  args: string[];
} {
  const script = process.argv[1] ?? "";

  if (script.endsWith(".ts") || script.endsWith(".tsx")) {
    return { command: "bun", args: [resolve(script), "mcp"] };
  }

  return { command: "bunx", args: ["kadai", "mcp"] };
}

/** Convert an action ID (e.g. "database/reset") to a valid MCP tool name */
export function actionIdToToolName(id: string): string {
  return id.replace(/\//g, "--");
}

/** Convert an MCP tool name back to an action ID */
export function toolNameToActionId(name: string): string {
  return name.replace(/--/g, "/");
}

function buildToolDescription(action: Action): string {
  const parts: string[] = [];
  if (action.meta.emoji) parts.push(action.meta.emoji);
  parts.push(action.meta.name);
  if (action.meta.description) {
    parts.push(`— ${action.meta.description}`);
  }
  return parts.join(" ");
}

interface McpJsonConfig {
  mcpServers?: Record<
    string,
    { command: string; args?: string[]; [key: string]: unknown }
  >;
  [key: string]: unknown;
}

/**
 * Ensure `.mcp.json` at the project root has a `kadai` entry.
 * Creates the file if missing, merges into existing if kadai entry absent.
 */
export async function ensureMcpConfig(projectRoot: string): Promise<void> {
  const mcpJsonPath = join(projectRoot, ".mcp.json");
  const mcpFile = Bun.file(mcpJsonPath);

  const kadaiEntry = resolveInvocationCommand();

  if (await mcpFile.exists()) {
    const existing: McpJsonConfig = await mcpFile.json();

    if (existing.mcpServers?.kadai) {
      process.stderr.write(
        "kadai MCP server already configured in .mcp.json\n",
      );
      return;
    }

    existing.mcpServers = existing.mcpServers ?? {};
    existing.mcpServers.kadai = kadaiEntry;
    await Bun.write(mcpJsonPath, `${JSON.stringify(existing, null, 2)}\n`);
    process.stderr.write("Added kadai entry to existing .mcp.json\n");
  } else {
    const config: McpJsonConfig = {
      mcpServers: {
        kadai: kadaiEntry,
      },
    };
    await Bun.write(mcpJsonPath, `${JSON.stringify(config, null, 2)}\n`);
    process.stderr.write("Created .mcp.json with kadai MCP server config\n");
  }
}

/**
 * Start the MCP stdio server, registering each non-hidden action as a tool.
 * If kadaiDir is null (no .kadai/ found), the server starts with zero tools.
 */
export async function startMcpServer(
  kadaiDir: string | null,
  cwd: string,
): Promise<void> {
  let visibleActions: Action[] = [];
  let config: KadaiConfig = {};

  if (kadaiDir) {
    config = await loadConfig(kadaiDir);
    const actionsDir = join(kadaiDir, config.actionsDir ?? "actions");
    let allActions = await loadActions(actionsDir);

    // Load plugin actions
    const globalActions = await loadUserGlobalActions();
    allActions = [...allActions, ...globalActions];

    if (config.plugins) {
      for (const source of config.plugins) {
        if ("path" in source) {
          const pathActions = await loadPathPlugin(kadaiDir, source);
          allActions = [...allActions, ...pathActions];
        }
      }
      const cachedActions = await loadCachedPlugins(kadaiDir, config.plugins);
      allActions = [...allActions, ...cachedActions];
    }

    visibleActions = allActions.filter((a) => !a.meta.hidden);
  }

  const server = new McpServer({ name: "kadai", version: "0.3.0" });

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(config.env ?? {}),
  };

  for (const action of visibleActions) {
    const toolName = actionIdToToolName(action.id);
    const description = buildToolDescription(action);

    server.registerTool(toolName, { description }, async () => {
      const cmd = resolveCommand(action);

      const proc = Bun.spawn(cmd, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env,
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      const parts: string[] = [];
      if (stdout) parts.push(stdout);
      if (stderr) parts.push(`[stderr]\n${stderr}`);
      if (exitCode !== 0) parts.push(`[exit code: ${exitCode}]`);

      return {
        content: [
          { type: "text" as const, text: parts.join("\n") || "(no output)" },
        ],
        isError: exitCode !== 0,
      };
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `kadai MCP server running (${visibleActions.length} tools)\n`,
  );
}
