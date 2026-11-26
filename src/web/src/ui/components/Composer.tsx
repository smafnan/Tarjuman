import { SendHorizontal } from 'lucide-react';
import { useState } from 'react';

import { LANGUAGES } from '../../../../shared/languages';
import { LIMITS } from '../../../../shared/protocol';
import type { ChannelId } from '../../../../shared/settings';
import { useAppStore } from '../../state/store';
import { controller } from '../controller';
import { Segmented } from './controls';

/**
 * Type instead of speaking: handy without a microphone, for names, or to test a channel.
 * The field and its button take the colour of whoever "says" the text.
 */
export function Composer() {
  const [channel, setChannel] = useState<ChannelId>('outgoing');
  const [text, setText] = useState('');
  const connected = useAppStore((state) => state.connection === 'connected');
  const sourceLang = useAppStore((state) => state.settings.session.channels[channel].sourceLang);

  // The box is emptied only once the server has the text: a connection lost at that moment
  // must not cost what was typed.
  const send = () => {
    if (!text.trim() || !connected) return;
    if (controller().sendText(channel, text)) setText('');
  };

  return (
    <form
      className={`composer composer--${channel}`}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <Segmented
        label="Who says this"
        hideLabel
        value={channel}
        options={[
          { value: 'outgoing', label: <span className="who who--outgoing">I say</span> },
          { value: 'incoming', label: <span className="who who--incoming">They say</span> },
        ]}
        onChange={setChannel}
      />
      <div className="composer__field">
        <textarea
          rows={1}
          dir="auto"
          maxLength={LIMITS.maxTextChars}
          value={text}
          disabled={!connected}
          aria-label={`Type in ${LANGUAGES[sourceLang].name}`}
          placeholder={
            connected ? `Type in ${LANGUAGES[sourceLang].name} instead of speaking…` : 'Not connected'
          }
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button
          type="submit"
          className="composer__send"
          title="Translate (Enter)"
          disabled={!connected || !text.trim()}
        >
          <SendHorizontal size={16} aria-hidden="true" />
          <span className="composer__send-label">Translate</span>
        </button>
      </div>
    </form>
  );
}
