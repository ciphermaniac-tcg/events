// ============================================================================
// Classifier label-normalization boundary
// ============================================================================
// Moved verbatim from functions/lib/analysis/archetypeClassifier.ts so the
// classifier's local name normalization has one home. Behavior is unchanged;
// the classifier now imports these.

/**
 * Collapse a raw archetype label to display form: underscores to spaces,
 * whitespace collapsed, trimmed. Preserves case (unlike {@link archetypeKey}).
 * @param value - Raw label
 * @returns Canonicalized display label
 */
export function canonicalizeArchetypeLabel(value: unknown): string {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a label for loose lookup/matching: canonicalized, lowercased,
 * apostrophes removed, any non-alphanumeric run collapsed to a single space,
 * trimmed. Looser than {@link archetypeKey} — used only for classifier rule
 * matching, never for identity keys.
 * @param value - Raw label
 * @returns Lookup-normalized string
 */
export function normalizeForLookup(value: unknown): string {
  return canonicalizeArchetypeLabel(value)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
