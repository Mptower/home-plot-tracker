let counter = 0;

/**
 * Stable unique id for list items and React keys.
 * Falls back to a counter + random suffix where `crypto.randomUUID` is missing.
 */
export function createId(prefix?: string): string {
  const base =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 10)}`;

  return prefix ? `${prefix}_${base}` : base;
}
