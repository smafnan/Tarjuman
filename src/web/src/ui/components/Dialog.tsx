import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { cx } from '../lib/cx';
import { prefersReducedMotion } from '../lib/motion';

/** How long the dialog takes to fade out (base.css); its content stays on the page that long. */
const CLOSING_MS = 240;

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A line under the title, also read out as the dialog's description. */
  subtitle?: string;
  icon?: ReactNode;
  /** `sheet` runs along the right edge at full height, for settings beside the conversation. */
  variant?: 'center' | 'sheet';
  className?: string;
  footer?: ReactNode;
  /**
   * Rendered inside the dialog, between its header and its content. A modal dialog makes
   * the rest of the page inert and covers it, so anything that must stay visible and
   * clickable while the dialog is open (the toast region) has to live in here.
   */
  overlay?: ReactNode;
  children: ReactNode;
}

/**
 * Modal dialog on the native <dialog> element: Escape closes it, focus is trapped while it
 * is open and returns to the opening control afterwards. The content is only mounted while
 * the dialog is open, and while it fades out.
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  icon,
  variant = 'center',
  className,
  footer,
  overlay,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const subtitleId = useId();
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (dialog.open) dialog.close();
    const gone = window.setTimeout(() => setPresent(false), prefersReducedMotion() ? 0 : CLOSING_MS);
    return () => window.clearTimeout(gone);
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx('dialog', variant === 'sheet' && 'dialog--sheet', className)}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onClose={onClose}
      // A press on the backdrop targets the <dialog> itself; its content fills the whole box.
      // Requiring press and release on the backdrop keeps a text selection that ends
      // outside the box from closing the dialog.
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) event.currentTarget.close();
        pressedBackdrop.current = false;
      }}
    >
      {present ? (
        <div className="dialog__frame">
          <header className="dialog__header">
            {icon}
            <div className="dialog__titles">
              <h2 className="dialog__title" id={titleId}>
                {title}
              </h2>
              {subtitle ? (
                <p className="dialog__subtitle" id={subtitleId}>
                  {subtitle}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={`Close ${title}`}
              title="Close"
              onClick={() => ref.current?.close()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          {overlay}
          <div className="dialog__body">{children}</div>
          {footer ? <footer className="dialog__footer">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
