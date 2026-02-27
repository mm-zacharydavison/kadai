/** Bun.which() result cache to avoid repeated PATH lookups */
const whichCache = new Map<string, string | null>();

/** Cached wrapper around Bun.which() — avoids repeated PATH lookups for the same binary */
export function cachedWhich(bin: string): string | null {
  if (whichCache.has(bin)) return whichCache.get(bin) ?? null;
  const result = Bun.which(bin);
  whichCache.set(bin, result ?? null);
  return result ?? null;
}
