/**
 * The tab that a key moves to under the ARIA tabs pattern (arrow keys wrap around, Home and
 * End jump to the ends), or null when the key is not a tab key.
 */
export function nextTab<T>(tabs: readonly T[], current: T, key: string): T | null {
  if (tabs.length === 0) return null;
  const index = tabs.indexOf(current);
  switch (key) {
    case 'ArrowRight':
      return tabs[(index + 1) % tabs.length] ?? null;
    case 'ArrowLeft':
      return tabs[(index <= 0 ? tabs.length : index) - 1] ?? null;
    case 'Home':
      return tabs[0] ?? null;
    case 'End':
      return tabs[tabs.length - 1] ?? null;
    default:
      return null;
  }
}
