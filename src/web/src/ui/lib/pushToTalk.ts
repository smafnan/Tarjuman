/**
 * Keyboard rules for push-to-talk, kept free of React and the DOM so they can be tested
 * with plain objects.
 */

// Space is these controls' own key: it types a blank, toggles a box or opens a list.
// Buttons, links and sliders are not on this list on purpose: after the usual setup clicks
// the focus sits on "Start microphone", and holding Space there must still talk.
const NON_TEXT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image', 'range', 'color', 'file']);

interface TargetLike {
  tagName?: unknown;
  type?: unknown;
  isContentEditable?: unknown;
}

/** True when the focused element needs Space for itself (typing, ticking, choosing). */
export function elementOwnsSpace(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const element = target as TargetLike;
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return false;
  const type = typeof element.type === 'string' ? element.type.toLowerCase() : 'text';
  return !NON_TEXT_INPUT_TYPES.has(type);
}

export interface KeyLike {
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: unknown;
  preventDefault(): void;
}

export interface PushToTalkKeys {
  keydown(event: KeyLike): void;
  keyup(event: Pick<KeyLike, 'code' | 'preventDefault'>): void;
  /** Lets go if Space is held (window lost focus, mode switched off). */
  release(): void;
}

/**
 * Space as a push-to-talk key. It is swallowed on both keydown and keyup while held, so a
 * focused button is not clicked when the key comes back up.
 */
export function createPushToTalkKeys(options: {
  setHeld: (held: boolean) => void;
  dialogOpen: () => boolean;
}): PushToTalkKeys {
  let held = false;

  const release = () => {
    if (!held) return;
    held = false;
    options.setHeld(false);
  };

  return {
    keydown(event) {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (held) {
        // Auto-repeat while holding: keep the page from scrolling or the button from clicking.
        event.preventDefault();
        return;
      }
      if (event.repeat || options.dialogOpen() || elementOwnsSpace(event.target)) return;
      event.preventDefault();
      held = true;
      options.setHeld(true);
    },
    keyup(event) {
      if (event.code !== 'Space' || !held) return;
      event.preventDefault();
      release();
    },
    release,
  };
}

export interface HoldKey {
  keydown(event: { key: string; repeat: boolean; preventDefault(): void }): void;
  keyup(event: { key: string; preventDefault(): void }): void;
  release(): void;
}

/** A key that holds an on-screen hold button down for as long as it is pressed. */
export function createHoldKey(keys: readonly string[], setHeld: (held: boolean) => void): HoldKey {
  let held = false;
  const release = () => {
    if (!held) return;
    held = false;
    setHeld(false);
  };
  return {
    keydown(event) {
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      if (held || event.repeat) return;
      held = true;
      setHeld(true);
    },
    keyup(event) {
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      release();
    },
    release,
  };
}
