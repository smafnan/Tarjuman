import type { NoticeLevel } from '../../state/types';

/**
 * How long a message stays before it goes away by itself. An error is the one thing the
 * person must not miss, so it stays until dismissed; a warning gets time to be read.
 */
export function autoDismissMs(level: NoticeLevel): number | null {
  switch (level) {
    case 'info':
    case 'success':
      return 6_000;
    case 'warning':
      return 10_000;
    case 'error':
      return null;
  }
}
