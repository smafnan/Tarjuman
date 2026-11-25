import { useEffect } from 'react';

import { useAppStore } from '../../state/store';
import { controller } from '../controller';
import { createPushToTalkKeys } from '../lib/pushToTalk';

/** While the microphone is in push-to-talk mode, holding Space opens it. */
export function usePushToTalk(): void {
  const enabled = useAppStore((state) => state.settings.outgoing.micMode === 'push-to-talk');

  useEffect(() => {
    if (!enabled) return;
    const keys = createPushToTalkKeys({
      setHeld: (held) => controller().setPushToTalk(held),
      // A modal dialog has its own keyboard; Space there belongs to its controls.
      dialogOpen: () => document.querySelector('dialog[open]') !== null,
    });

    // Capture phase: a component that stops propagation must not leave the microphone stuck open.
    window.addEventListener('keydown', keys.keydown, true);
    window.addEventListener('keyup', keys.keyup, true);
    window.addEventListener('blur', keys.release);
    return () => {
      window.removeEventListener('keydown', keys.keydown, true);
      window.removeEventListener('keyup', keys.keyup, true);
      window.removeEventListener('blur', keys.release);
      keys.release();
    };
  }, [enabled]);
}
