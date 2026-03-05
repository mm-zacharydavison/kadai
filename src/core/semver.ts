type SemverTuple = [number, number, number];

/**
 * Parse a semver string like "1.2.3" into a [major, minor, patch] tuple.
 * Returns null if the string is not a valid semver.
 */
export function parseSemver(version: string): SemverTuple | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compare two semver tuples. Returns:
 * - negative if a < b
 * - 0 if a === b
 * - positive if a > b
 */
export function compareSemver(a: SemverTuple, b: SemverTuple): number {
  for (let i = 0; i < 3; i++) {
    const diff = a[i] - b[i];
    if (diff !== 0) return diff;
  }
  return 0;
}
