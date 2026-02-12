import { mkdtemp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceConfig, SourceMeta } from "../types.ts";

const META_FILENAME = ".source-meta.json";

export interface SourceFetcher {
  /** Fetch a source into destDir (may overwrite contents) */
  fetch(source: SourceConfig, destDir: string): Promise<void>;
  /** Read cached metadata from a source directory */
  readMeta(destDir: string): Promise<SourceMeta | null>;
  /** Write metadata for a freshly fetched source */
  writeMeta(destDir: string, source: SourceConfig): Promise<void>;
}

export class GitFetcher implements SourceFetcher {
  async fetch(source: SourceConfig, destDir: string): Promise<void> {
    const ref = source.ref ?? "main";
    const url = `https://github.com/${source.repo}.git`;

    // Clone into a temp dir, then move contents into destDir
    const tempDir = await mkdtemp(join(tmpdir(), "xcli-clone-"));

    try {
      await Bun.$`git clone --depth 1 --branch ${ref} ${url} ${tempDir}/repo`.quiet();

      // Remove destDir contents and replace with cloned data
      await Bun.$`rm -rf ${destDir}`.quiet();
      await rename(`${tempDir}/repo`, destDir);
    } catch (err) {
      // Clean up temp dir on failure
      await Bun.$`rm -rf ${tempDir}`.quiet();
      throw new Error(
        `Failed to fetch ${source.repo}@${ref}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Clean up temp container
    await Bun.$`rm -rf ${tempDir}`.quiet();
  }

  async readMeta(destDir: string): Promise<SourceMeta | null> {
    try {
      const metaPath = join(destDir, META_FILENAME);
      const file = Bun.file(metaPath);
      if (!(await file.exists())) return null;
      return (await file.json()) as SourceMeta;
    } catch {
      return null;
    }
  }

  async writeMeta(destDir: string, source: SourceConfig): Promise<void> {
    const meta: SourceMeta = {
      fetchedAt: new Date().toISOString(),
      repo: source.repo,
      ref: source.ref ?? "main",
    };
    const metaPath = join(destDir, META_FILENAME);
    await Bun.write(metaPath, JSON.stringify(meta, null, 2));
  }
}
