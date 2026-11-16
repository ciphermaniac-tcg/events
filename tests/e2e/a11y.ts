/**
 * Accessibility and fit for a rendered page: axe with the WCAG 2.2 AA tags
 * (target size is off unless asked for), and no sideways scroll.
 * @module tests/e2e/a11y
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Fails on any violation not in `known`, written `rule|target`. Like the drift
 * baseline, a known list is for failures waiting on a design call, and only shrinks.
 */
export async function expectAccessible(page: Page, known: readonly string[] = []): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = violations.flatMap(v => v.nodes.map(n => `${v.id}|${n.target.join(' ')}`));
  expect(found.filter(key => !known.includes(key))).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}
