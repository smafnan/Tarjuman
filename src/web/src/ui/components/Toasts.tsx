import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect } from 'react';

import { useAppStore } from '../../state/store';
import type { Notice } from '../../state/types';
import { controller } from '../controller';
import { autoDismissMs } from '../lib/notices';

const ICON = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert } as const;

function Toast({ notice }: { notice: Notice }) {
  const Icon = ICON[notice.level];
  const dismissAfter = autoDismissMs(notice.level);

  useEffect(() => {
    if (dismissAfter === null) return;
    const timer = setTimeout(() => controller().dismissNotice(notice.id), dismissAfter);
    return () => clearTimeout(timer);
  }, [notice.id, dismissAfter]);

  return (
    <div className={`toast toast--${notice.level}`}>
      <Icon size={16} aria-hidden="true" />
      <span className="toast__text">{notice.message}</span>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss"
        onClick={() => controller().dismissNotice(notice.id)}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

interface ToastsProps {
  /** `page` floats over the transcript; `dialog` sits in the flow of an open dialog. */
  placement: 'page' | 'dialog';
  /** The page copy stays mounted behind an open dialog (it is inert there) but must not show twice. */
  covered?: boolean;
}

/**
 * Transient messages. One copy lives on the page and one inside every dialog, because a
 * modal dialog makes the rest of the page inert (and so silent for screen readers).
 *
 * Both live regions are always in the document and are empty when they mount; a live
 * region is only announced for changes after it exists, so a region that appears together
 * with its first message would stay silent. Errors go to a separate alert region.
 */
export function Toasts({ placement, covered = false }: ToastsProps) {
  const notices = useAppStore((state) => state.notices);
  const errors = notices.filter((notice) => notice.level === 'error');
  const others = notices.filter((notice) => notice.level !== 'error');
  const className = ['toasts', `toasts--${placement}`];
  if (covered) className.push('is-covered');
  if (notices.length > 0) className.push('has-toasts');

  return (
    <div className={className.join(' ')}>
      <div className="toasts__group" role="status" aria-live="polite" aria-relevant="additions text">
        {others.map((notice) => (
          <Toast key={notice.id} notice={notice} />
        ))}
      </div>
      <div className="toasts__group" role="alert">
        {errors.map((notice) => (
          <Toast key={notice.id} notice={notice} />
        ))}
      </div>
    </div>
  );
}
