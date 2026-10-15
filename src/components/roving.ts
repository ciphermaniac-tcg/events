/**
 * Where the arrow keys, Home and End move focus in a row of `count` controls
 * from `from`, wrapping at either end, as tabs and radio groups expect; null
 * for any other key.
 */
export function rovingIndex(key: string, from: number, count: number): number | null {
  const steps: Record<string, number> = {
    ArrowRight: (from + 1) % count,
    ArrowDown: (from + 1) % count,
    ArrowLeft: (from + count - 1) % count,
    ArrowUp: (from + count - 1) % count,
    Home: 0,
    End: count - 1
  };
  return count > 0 && key in steps ? (steps[key] ?? null) : null;
}
