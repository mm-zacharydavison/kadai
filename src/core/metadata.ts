import type { ActionMeta } from "../types.ts";

const META_PATTERN = /^(?:#|\/\/)\s*kadai:(\w+)\s+(.+)$/;
const MAX_SCAN_LINES = 20;

function parseMetadataFromContent(content: string): Partial<ActionMeta> {
  const lines = content.split("\n").slice(0, MAX_SCAN_LINES);
  const meta: Partial<ActionMeta> = {};

  for (const line of lines) {
    const match = line.match(META_PATTERN);
    if (!match) continue;

    const key = match[1];
    const value = match[2];
    if (!key || !value) continue;
    switch (key) {
      case "name":
        meta.name = value.trim();
        break;
      case "emoji":
        meta.emoji = value.trim();
        break;
      case "description":
        meta.description = value.trim();
        break;
      case "confirm":
        meta.confirm = value.trim() === "true";
        break;
      case "hidden":
        meta.hidden = value.trim() === "true";
        break;
      case "interactive":
        meta.interactive = value.trim() === "true";
        break;
    }
  }

  return meta;
}

function inferNameFromFilename(filename: string): string {
  const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
  return nameWithoutExt
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function extractMetadata(filePath: string): Promise<ActionMeta> {
  const file = Bun.file(filePath);
  const content = await file.text();
  const filename = filePath.split("/").pop() ?? filePath;

  // Try comment frontmatter first
  const frontmatter = parseMetadataFromContent(content);
  if (frontmatter.name) {
    return {
      name: frontmatter.name,
      emoji: frontmatter.emoji,
      description: frontmatter.description,
      confirm: frontmatter.confirm ?? false,
      hidden: frontmatter.hidden ?? false,
      interactive: frontmatter.interactive ?? false,
    };
  }

  // Fallback: infer from filename
  return {
    name: inferNameFromFilename(filename),
    confirm: false,
    hidden: false,
    interactive: false,
  };
}
