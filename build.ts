#!/usr/bin/env bun
import type { BunPlugin } from "bun";
import { $ } from "bun";

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

const result = await Bun.build({
  entrypoints: ["./src/cli.tsx"],
  outdir: "./dist",
  target: "bun",
  minify: false,
  format: "esm",
  plugins: [stubDevtools],
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
