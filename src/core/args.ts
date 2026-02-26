export type ParsedArgs =
  | { type: "interactive" }
  | { type: "list"; all: boolean }
  | { type: "run"; actionId: string }
  | { type: "error"; message: string };

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { type: "interactive" };
  }

  const command = argv[0];

  switch (command) {
    case "list": {
      if (!argv.includes("--json")) {
        return { type: "error", message: "Usage: kadai list --json [--all]" };
      }
      const all = argv.includes("--all");
      return { type: "list", all };
    }

    case "run": {
      const actionId = argv[1];
      if (!actionId || actionId.startsWith("-")) {
        return {
          type: "error",
          message: "Usage: kadai run <action ID>",
        };
      }
      return { type: "run", actionId };
    }

    default:
      return {
        type: "error",
        message: `Unknown command: ${command}. Available commands: list, run`,
      };
  }
}
