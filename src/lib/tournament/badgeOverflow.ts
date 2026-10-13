import type { Badge } from '../../../shared/accounts/achievements';

interface Measurements {
  badge: number;
  gap: number;
  divider: number;
  more: number;
}

function rowWidth(badges: readonly Badge[], size: Measurements): number {
  const held = badges.some(badge => !('tier' in badge));
  const counted = badges.some(badge => 'tier' in badge);
  const divider = held && counted ? size.divider + size.gap : 0;
  return badges.length * size.badge + Math.max(0, badges.length - 1) * size.gap + divider;
}

/** Show everything that fits on one line, reserving the overflow button only when necessary. */
export function visibleBadgeCount(badges: readonly Badge[], available: number, size: Measurements): number {
  if (rowWidth(badges, size) <= available) {
    return badges.length;
  }
  for (let count = badges.length - 1; count > 0; count -= 1) {
    if (rowWidth(badges.slice(0, count), size) + size.gap + size.more <= available) {
      return count;
    }
  }
  return 0;
}
