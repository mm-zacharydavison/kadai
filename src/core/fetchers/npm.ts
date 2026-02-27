import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { NpmPluginSource } from "../../types.ts";
import type { FetchResult } from "./types.ts";

const REGISTRY = "https://registry.npmjs.org";

interface NpmVersionData {
  dist: { tarball: string };
}

interface NpmPackageMetadata {
  "dist-tags": Record<string, string>;
  versions: Record<string, NpmVersionData>;
}

/**
 * Parse a semver string into [major, minor, patch] numbers.
 * Returns null if not a valid semver.
 */
function parseSemver(v: string): [number, number, number] | null {
  // Strip leading "v" and any prerelease/build metadata for comparison
  const withoutPrerelease = v.replace(/^v/, "").split("-")[0] ?? "";
  const clean = withoutPrerelease.split("+")[0] ?? "";
  const parts = clean.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  return nums as [number, number, number];
}

/** Compare two semver arrays. Returns >0 if a > b, <0 if a < b, 0 if equal. */
function compareSemver(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Simple semver range satisfier. Supports:
 * - Exact: "1.2.3"
 * - Caret: "^1.2.3" (>=1.2.3 <2.0.0)
 * - Tilde: "~1.2.3" (>=1.2.3 <1.3.0)
 * - Wildcard/star: "*" or "x"
 */
function satisfies(version: string, range: string): boolean {
  if (range === "*" || range === "x") return true;

  const parsed = parseSemver(version);
  if (!parsed) return false;

  if (range.startsWith("^")) {
    const min = parseSemver(range.slice(1));
    if (!min) return false;
    if (compareSemver(parsed, min) < 0) return false;
    // ^0.x.y — constrain to same minor if major is 0
    if (min[0] === 0) {
      return parsed[0] === 0 && parsed[1] === min[1];
    }
    return parsed[0] === min[0];
  }

  if (range.startsWith("~")) {
    const min = parseSemver(range.slice(1));
    if (!min) return false;
    if (compareSemver(parsed, min) < 0) return false;
    return parsed[0] === min[0] && parsed[1] === min[1];
  }

  // Exact match
  const exact = parseSemver(range);
  if (!exact) return false;
  return compareSemver(parsed, exact) === 0;
}

/**
 * Resolve the best matching version for a given npm source.
 * - If version is "latest" or unset, uses the dist-tag.
 * - If version is an exact version, uses it directly.
 * - For semver ranges, picks the highest matching version.
 */
async function resolveVersion(
  source: NpmPluginSource,
): Promise<{ version: string; tarballUrl: string }> {
  const version = source.version ?? "latest";

  const res = await fetch(`${REGISTRY}/${encodeURIComponent(source.npm)}`);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch npm package "${source.npm}": ${res.status} ${res.statusText}`,
    );
  }

  const meta = (await res.json()) as NpmPackageMetadata;

  // Check dist-tags first (handles "latest", "next", etc.)
  const tagVersion = meta["dist-tags"][version];
  if (tagVersion) {
    const versionData = meta.versions[tagVersion];
    if (!versionData) {
      throw new Error(
        `npm package "${source.npm}": version ${tagVersion} not found in registry`,
      );
    }
    return { version: tagVersion, tarballUrl: versionData.dist.tarball };
  }

  // Exact version match
  const exactData = meta.versions[version];
  if (exactData) {
    return { version, tarballUrl: exactData.dist.tarball };
  }

  // Semver range: pick the highest matching version
  const allVersions = Object.keys(meta.versions);
  const matching = allVersions
    .filter((v) => satisfies(v, version))
    .map((v) => ({ version: v, parsed: parseSemver(v) }))
    .filter(
      (v): v is { version: string; parsed: [number, number, number] } =>
        v.parsed !== null,
    )
    .sort((a, b) => compareSemver(b.parsed, a.parsed));

  if (matching.length === 0) {
    throw new Error(
      `npm package "${source.npm}": no version matching "${version}" found`,
    );
  }

  const bestMatch = matching[0];
  if (!bestMatch) {
    throw new Error(
      `npm package "${source.npm}": no version matching "${version}" found`,
    );
  }
  const best = bestMatch.version;
  const bestData = meta.versions[best];
  if (!bestData) {
    throw new Error(
      `npm package "${source.npm}": version data for ${best} missing`,
    );
  }
  return { version: best, tarballUrl: bestData.dist.tarball };
}

/**
 * Fetch an npm plugin and extract it into destDir.
 * Downloads the tarball directly from the npm registry and extracts it.
 */
export async function fetchNpmPlugin(
  source: NpmPluginSource,
  destDir: string,
): Promise<FetchResult> {
  const { version, tarballUrl } = await resolveVersion(source);

  // Download tarball
  const tarballRes = await fetch(tarballUrl);
  if (!tarballRes.ok || !tarballRes.body) {
    throw new Error(
      `Failed to download tarball for "${source.npm}@${version}": ${tarballRes.status}`,
    );
  }

  // npm tarballs have a `package/` prefix directory
  await mkdir(destDir, { recursive: true });

  const tarball = await tarballRes.arrayBuffer();
  const tarballPath = join(destDir, ".plugin.tgz");
  await Bun.write(tarballPath, tarball);

  // Extract using tar — strip the top-level `package/` directory
  const proc = Bun.spawn(["tar", "xzf", tarballPath, "--strip-components=1"], {
    cwd: destDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to extract tarball: ${stderr}`);
  }

  await unlink(tarballPath);

  return { resolvedVersion: version };
}

/**
 * Check if a newer version of an npm package is available.
 * Returns true if the latest matching version differs from currentVersion.
 */
export async function checkNpmUpdate(
  source: NpmPluginSource,
  currentVersion: string,
): Promise<boolean> {
  try {
    const { version } = await resolveVersion(source);
    return version !== currentVersion;
  } catch {
    // Network error or package not found — assume no update
    return false;
  }
}
