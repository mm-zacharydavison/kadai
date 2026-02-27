#!/usr/bin/env bun
import type { BunPlugin } from "bun";
import { $ } from "bun";
import { SHARED_DEPS } from "./src/core/shared-deps.ts";

const stubDevtools: BunPlugin = {
  name: "stub-devtools",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default {}",
      loader: "js",
    }));
  },
};

// Shared UI deps (SHARED_DEPS) must stay external so that dynamically
// imported .tsx actions resolve the same module instances at runtime.
// Bundling them would create a second React copy, breaking hooks.
// MCP SDK is external for similar reasons (uses Node APIs that don't bundle).
const external = [
  ...SHARED_DEPS,
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/server/mcp.js",
  "@modelcontextprotocol/sdk/server/stdio.js",
];

const result = await Bun.build({
  entrypoints: ["./src/cli.tsx"],
  outdir: "./dist",
  target: "bun",
  minify: false,
  format: "esm",
  plugins: [stubDevtools],
  external,
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const outPath = "./dist/cli.js";
await $`chmod +x ${outPath}`;

console.log("Built dist/cli.js");
