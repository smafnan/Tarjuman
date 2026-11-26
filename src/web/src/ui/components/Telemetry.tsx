import { useShallow } from 'zustand/react/shallow';

import { useAppStore } from '../../state/store';
import { formatSeconds } from '../lib/format';

/**
 * Two measurements of the conversation so far, between the two sides of the console: how long
 * the last sentence took to come out interpreted, and how many sentences have been. Each
 * figure rises in again when it changes (its value is its key).
 */
export function Telemetry() {
  const { delay, count } = useAppStore(
    useShallow((state) => {
      let delay: number | null = null;
      let count = 0;
      for (const entry of state.transcript) {
        if (entry.status === 'done' || entry.status === 'speaking') count += 1;
        if (entry.latencyMs !== null) delay = entry.latencyMs;
      }
      return { delay, count };
    }),
  );

  return (
    <dl className="telemetry">
      <div className="telemetry__item">
        <dt>Last delay</dt>
        <dd key={delay ?? 'none'}>{delay === null ? '–.–' : formatSeconds(delay)}</dd>
      </div>
      <div className="telemetry__item">
        <dt>Sentences</dt>
        <dd key={count}>{String(count).padStart(2, '0')}</dd>
      </div>
    </dl>
  );
}
