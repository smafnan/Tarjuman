import { useAppStore } from '../../state/store';
import { formatSeconds } from '../lib/format';

/**
 * Two measurements of the conversation so far, between the two sides of the console: how long
 * the last sentence took to come out interpreted, and how many sentences have been. Each
 * figure rolls in again when it changes (its value is its key). Both are running totals kept
 * by the store: the on-screen transcript keeps only its newest rows, and recounting it would
 * run on every update of the store, the audio levels included.
 */
export function Telemetry() {
  const delay = useAppStore((state) => state.lastDelayMs);
  const count = useAppStore((state) => state.interpreted);

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
