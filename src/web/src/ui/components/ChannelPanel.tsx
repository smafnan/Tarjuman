import { Mic, MonitorSpeaker, SlidersHorizontal, Square, TriangleAlert, Volume2 } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { LANGUAGES } from '../../../../shared/languages';
import { SPEECH_RATE_MAX, SPEECH_RATE_MIN, type ChannelId } from '../../../../shared/settings';
import { useAppStore } from '../../state/store';
import { controller } from '../controller';
import { CHANNEL_COPY, sessionChannelPatch } from '../lib/channels';
import { cx } from '../lib/cx';
import { deviceOptions } from '../lib/devices';
import { formatPercent, formatRate, formatSeconds } from '../lib/format';
import { createHoldKey } from '../lib/pushToTalk';
import { SelectField, Segmented, Slider, Spinner, Switch } from './controls';
import { Dialog } from './Dialog';

/**
 * More queued speech than one ordinary sentence means the interpreter has fallen behind;
 * only then is the queue (and the way to skip it) worth showing.
 */
const BACKLOG_NOTICE_MS = 6_000;

/** Subscribed to the level alone, so ten updates a second repaint only this bar. */
function LevelMeter({ channel }: { channel: ChannelId }) {
  const level = useAppStore((state) => state.channels[channel].level);
  const gated = useAppStore((state) => state.channels[channel].gated);
  return (
    <div className={cx('meter', gated && 'meter--gated')} role="presentation">
      <div className="meter__fill" style={{ transform: `scaleX(${level.toFixed(3)})` }} />
    </div>
  );
}

type LampState = 'off' | 'starting' | 'live' | 'speaking' | 'gated' | 'error';

/** The channel's lamp. Decorative: the key and the status line say the same in words. */
function Lamp({ channel }: { channel: ChannelId }) {
  const state = useAppStore((app): LampState => {
    const runtime = app.channels[channel];
    if (runtime.captureError) return 'error';
    if (runtime.capture === 'starting') return 'starting';
    if (runtime.capture !== 'capturing') return 'off';
    if (runtime.gated) return 'gated';
    return runtime.speaking ? 'speaking' : 'live';
  });
  return <span className={`lamp lamp--${state}`} aria-hidden="true" />;
}

function CaptureStatus({ channel }: { channel: ChannelId }) {
  const runtime = useAppStore(
    useShallow((state) => {
      const c = state.channels[channel];
      return {
        capture: c.capture,
        captureError: c.captureError,
        sourceLabel: c.sourceLabel,
        speaking: c.speaking,
        gated: c.gated,
        pttHeld: c.pttHeld,
      };
    }),
  );
  const pushToTalk = useAppStore(
    (state) => channel === 'outgoing' && state.settings.outgoing.micMode === 'push-to-talk',
  );

  if (runtime.captureError) return <p className="status status--error">{runtime.captureError}</p>;
  if (runtime.capture === 'starting') return <p className="status">Starting…</p>;
  if (runtime.capture !== 'capturing') return <p className="status">{CHANNEL_COPY[channel].idle}</p>;
  if (pushToTalk) {
    return runtime.pttHeld ? (
      <p className="status status--live">Listening…</p>
    ) : (
      // Space goes to whichever window has the keyboard focus: with Teams in front, it goes to Teams.
      <p className="status">Hold Space to talk while this window is focused</p>
    );
  }
  if (runtime.gated) return <p className="status">Paused while the translation plays</p>;
  if (runtime.speaking) return <p className="status status--live">Speaking…</p>;
  return (
    <p className="status" title={runtime.sourceLabel ?? undefined}>
      {runtime.sourceLabel ?? 'Listening'}
    </p>
  );
}

function Activity({ channel }: { channel: ChannelId }) {
  const { pending, queueMs, playing } = useAppStore(
    useShallow((state) => {
      const c = state.channels[channel];
      // Whole 100 ms steps: the queue length is informative, not a stopwatch.
      return { pending: c.pending, queueMs: Math.round(c.queueMs / 100) * 100, playing: c.playing };
    }),
  );
  return (
    <div className="activity">
      {pending > 0 ? (
        <span className="activity__item">
          <Spinner size={14} /> Translating {pending}
        </span>
      ) : null}
      {playing ? (
        <span className="activity__item">
          <Volume2 size={14} aria-hidden="true" /> Speaking the translation
        </span>
      ) : null}
      {queueMs > BACKLOG_NOTICE_MS ? (
        <span className="activity__item">
          {formatSeconds(queueMs)} of speech queued
          <button
            type="button"
            className="button button--small"
            onClick={() => controller().flushPlayback(channel)}
          >
            Skip
          </button>
        </span>
      ) : null}
    </div>
  );
}

function HoldToTalk() {
  const held = useAppStore((state) => state.channels.outgoing.pttHeld);
  const press = (down: boolean) => () => controller().setPushToTalk(down);
  // Space is handled for the whole page (usePushToTalk); Enter only has to work on this button.
  const enter = useMemo(() => createHoldKey(['Enter'], (down) => controller().setPushToTalk(down)), []);
  return (
    <button
      type="button"
      className={cx('ptt', held && 'is-held')}
      aria-pressed={held}
      onKeyDown={(event) => enter.keydown(event)}
      onKeyUp={(event) => enter.keyup(event)}
      onBlur={enter.release}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        controller().setPushToTalk(true);
      }}
      onPointerUp={press(false)}
      onPointerCancel={press(false)}
      onLostPointerCapture={press(false)}
    >
      {held ? 'Listening — release to translate' : 'Hold to talk (or hold Space)'}
    </button>
  );
}

/**
 * What would keep the translated voice from arriving where it should, said where it is seen
 * during a call, with the fix one click away. The device lists themselves live in the sheet.
 */
function RoutingNote({ channel, onOpenGuide }: { channel: ChannelId; onOpenGuide: () => void }) {
  const sinkOk = useAppStore((state) => state.channels[channel].sinkOk);
  const devices = useAppStore((state) => state.devices);
  const sinkId = useAppStore((state) => state.settings.outgoing.sinkId);

  if (!sinkOk) {
    return (
      <p className="module__note module__note--danger">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>The chosen output could not be used; the translation plays on the default device.</span>
      </p>
    );
  }
  if (channel !== 'outgoing' || !devices.labelsAvailable || !devices.canChooseOutput) return null;
  if (devices.outputs.some((device) => device.virtual && device.deviceId === sinkId)) return null;

  const cable = devices.outputs.find((device) => device.virtual);
  return (
    <p className="module__note">
      <TriangleAlert size={14} aria-hidden="true" />
      <span>
        Teams only hears the translation through a virtual cable.{' '}
        {cable ? (
          <button
            type="button"
            className="link-button"
            title={cable.label}
            onClick={() => controller().updateSettings({ outgoing: { sinkId: cable.deviceId } })}
          >
            Use the virtual cable
          </button>
        ) : (
          <button type="button" className="link-button" onClick={onOpenGuide}>
            How to set one up
          </button>
        )}
      </span>
    </p>
  );
}

function VoiceControls({ channel }: { channel: ChannelId }) {
  const settings = useAppStore((state) => state.settings.session.channels[channel]);
  const voices = useAppStore((state) => state.server?.voices);
  const options = [
    { value: 'auto', label: 'Default voice' },
    ...(voices ?? [])
      .filter((voice) => voice.lang === settings.targetLang)
      .map((voice) => ({ value: voice.id, label: `${voice.label} · ${voice.gender}` })),
  ];
  // A voice saved earlier may not exist on this server; show it as the default instead of a blank select.
  const value = options.some((option) => option.value === settings.voice) ? settings.voice : 'auto';

  return (
    <>
      <SelectField
        label={`${LANGUAGES[settings.targetLang].name} voice`}
        value={value}
        options={options}
        onChange={(voice) => controller().updateSettings(sessionChannelPatch(channel, { voice }))}
        disabled={!settings.speak}
      />
      <Switch
        checked={settings.speak}
        onChange={(speak) => controller().updateSettings(sessionChannelPatch(channel, { speak }))}
        label="Speak the translation"
        note={settings.speak ? undefined : 'Captions only.'}
      />
    </>
  );
}

function RateAndVolume({ channel }: { channel: ChannelId }) {
  const rate = useAppStore((state) => state.settings.session.channels[channel].speechRate);
  const volume = useAppStore((state) => state.settings[channel].volume);
  return (
    <>
      <Slider
        label="Speaking rate"
        value={rate}
        min={SPEECH_RATE_MIN}
        max={SPEECH_RATE_MAX}
        step={0.05}
        format={formatRate}
        onChange={(speechRate) => controller().updateSettings(sessionChannelPatch(channel, { speechRate }))}
        note="Speeds up by itself when translated speech is piling up."
      />
      <Slider
        label="Voice volume"
        value={volume}
        min={0}
        max={1.5}
        step={0.05}
        format={formatPercent}
        onChange={(value) =>
          controller().updateSettings(
            channel === 'outgoing' ? { outgoing: { volume: value } } : { incoming: { volume: value } },
          )
        }
      />
    </>
  );
}

function OutgoingControls() {
  const local = useAppStore((state) => state.settings.outgoing);
  const devices = useAppStore((state) => state.devices);
  const sinkOk = useAppStore((state) => state.channels.outgoing.sinkOk);
  const chosenSink = devices.outputs.find((device) => device.deviceId === local.sinkId);
  const update = controller().updateSettings.bind(controller());

  return (
    <div className="controls">
      <SelectField
        label="Microphone"
        value={local.micDeviceId}
        options={deviceOptions(devices.inputs, local.micDeviceId, 'Microphone')}
        onChange={(micDeviceId) => update({ outgoing: { micDeviceId } })}
      />
      <SelectField
        label="Translated voice goes to"
        value={local.sinkId}
        options={deviceOptions(devices.outputs, local.sinkId, 'Speaker')}
        onChange={(sinkId) => update({ outgoing: { sinkId } })}
        disabled={!devices.canChooseOutput}
        badge={chosenSink?.virtual ? <span className="badge badge--ok">virtual cable</span> : undefined}
        note={
          !sinkOk ? (
            <span className="field__note--danger">
              Could not use this output; playing on the default device.
            </span>
          ) : chosenSink?.virtual ? undefined : (
            <span className="field__note--warn">
              The other side only hears the translation if this is a virtual cable that Teams uses as its
              microphone.
            </span>
          )
        }
      />
      <VoiceControls channel="outgoing" />

      <details className="advanced">
        <summary>Advanced</summary>
        <div className="advanced__body">
          <Segmented
            label="Microphone mode"
            value={local.micMode}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'push-to-talk', label: 'Push-to-talk' },
            ]}
            onChange={(micMode) => update({ outgoing: { micMode } })}
          />
          <Slider
            label="Let them hear my own voice underneath"
            value={local.passthroughGain}
            min={0}
            max={1}
            step={0.05}
            format={formatPercent}
            onChange={(passthroughGain) => update({ outgoing: { passthroughGain } })}
            note="Only applies when the output is a virtual cable."
          />
          <Slider
            label="Hear my translation in my headphones"
            value={local.monitorGain}
            min={0}
            max={1}
            step={0.05}
            format={formatPercent}
            onChange={(monitorGain) => update({ outgoing: { monitorGain } })}
          />
          <RateAndVolume channel="outgoing" />
        </div>
      </details>
    </div>
  );
}

function IncomingControls() {
  const local = useAppStore((state) => state.settings.incoming);
  const devices = useAppStore((state) => state.devices);
  const { sinkOk, replaysOriginal, capturing } = useAppStore(
    useShallow((state) => ({
      sinkOk: state.channels.incoming.sinkOk,
      replaysOriginal: state.channels.incoming.replaysOriginal,
      capturing: state.channels.incoming.capture === 'capturing',
    })),
  );
  const update = controller().updateSettings.bind(controller());

  return (
    <div className="controls">
      <Segmented
        label="Listen to"
        value={local.sourceKind}
        options={[
          { value: 'display', label: 'Browser tab or screen' },
          { value: 'device', label: 'Audio device' },
        ]}
        onChange={(sourceKind) => update({ incoming: { sourceKind } })}
        disabled={capturing}
      />
      {local.sourceKind === 'device' ? (
        <SelectField
          label="Device that carries the call audio"
          value={local.deviceId}
          options={deviceOptions(devices.inputs, local.deviceId, 'Input')}
          onChange={(deviceId) => update({ incoming: { deviceId } })}
          note="Usually a second virtual cable that Teams uses as its speaker."
        />
      ) : !devices.canCaptureDisplayAudio && devices.inputs.length > 0 ? (
        <p className="field__note field__note--warn">
          This browser cannot share tab or system audio. Use Chrome or Edge, or choose "Audio device".
        </p>
      ) : null}
      <SelectField
        label="Translated voice plays on"
        value={local.sinkId}
        options={deviceOptions(devices.outputs, local.sinkId, 'Speaker')}
        onChange={(sinkId) => update({ incoming: { sinkId } })}
        disabled={!devices.canChooseOutput}
        note={
          sinkOk ? undefined : (
            <span className="field__note--danger">
              Could not use this output; playing on the default device.
            </span>
          )
        }
      />
      <VoiceControls channel="incoming" />

      <details className="advanced">
        <summary>Advanced</summary>
        <div className="advanced__body">
          <Slider
            label="Original voice volume"
            value={local.originalGain}
            min={0}
            max={1}
            step={0.05}
            format={formatPercent}
            onChange={(originalGain) => update({ incoming: { originalGain } })}
            disabled={capturing && !replaysOriginal}
            note="Applies when Tarjuman replays the original: a muted tab, or a virtual cable."
          />
          <Switch
            checked={local.duckOriginal}
            onChange={(duckOriginal) => update({ incoming: { duckOriginal } })}
            label="Lower the original while the translation plays"
          />
          <Switch
            checked={local.suppressLocalTabAudio}
            onChange={(suppressLocalTabAudio) => update({ incoming: { suppressLocalTabAudio } })}
            label="Mute the captured tab itself"
            note="You then hear the original only through Tarjuman, at the volume above. Browser tabs only; takes effect the next time capture starts."
          />
          <RateAndVolume channel="incoming" />
        </div>
      </details>
    </div>
  );
}

function useFlow(channel: ChannelId): string {
  const flow = useAppStore(
    useShallow((state) => {
      const c = state.settings.session.channels[channel];
      return { source: c.sourceLang, target: c.targetLang };
    }),
  );
  return `${LANGUAGES[flow.source].name} → ${LANGUAGES[flow.target].name}`;
}

interface ChannelPanelProps {
  channel: ChannelId;
  onOpenDevices: () => void;
  onOpenGuide: () => void;
}

/**
 * What the keys say where a side is only a narrow column (a phone). Each is the beginning of
 * the key's full name, so what is read on the key is still what the button is called, and
 * the two sides never show the same word.
 */
const SHORT_KEY: Record<ChannelId, { start: string; stop: string }> = {
  outgoing: { start: 'Start mic', stop: 'Stop mic' },
  incoming: { start: 'Capture', stop: 'Stop' },
};

type Stage = 'off' | 'idle' | 'hear' | 'write' | 'translate' | 'speak';

const STAGES = [
  { id: 'hear', label: 'Hear' },
  { id: 'write', label: 'Write' },
  { id: 'translate', label: 'Translate' },
  { id: 'speak', label: 'Speak' },
] as const;

/**
 * Where the channel's current sentence is on its way: heard, written down, translated,
 * spoken. A light travels along the line into the step that is at work. It draws what the
 * status line and the activity say in words, so it is hidden from screen readers.
 */
function Pipeline({ channel }: { channel: ChannelId }) {
  const stage = useAppStore((state): Stage => {
    const runtime = state.channels[channel];
    if (runtime.capture !== 'capturing') return 'off';
    if (runtime.playing) return 'speak';
    // The channel's newest sentence, if it is still on its way.
    for (let i = state.transcript.length - 1; i >= 0 && i >= state.transcript.length - 8; i--) {
      const entry = state.transcript[i];
      if (!entry || entry.channel !== channel) continue;
      if (entry.status === 'speaking') return 'speak';
      if (entry.status === 'translating') return 'translate';
      if (entry.status === 'transcribing') return 'write';
      break;
    }
    if (runtime.pending > 0) return 'translate';
    return runtime.speaking ? 'hear' : 'idle';
  });
  const at = STAGES.findIndex((item) => item.id === stage);

  return (
    <ol className={cx('pipeline', stage === 'off' && 'is-off')} aria-hidden="true">
      {STAGES.map((item, index) => (
        <li
          key={item.id}
          className={cx(
            'pipeline__stage',
            index === at && 'is-active',
            index < at && 'is-passed',
            stage === 'idle' && index === 0 && 'is-waiting',
          )}
        >
          {item.label}
        </li>
      ))}
    </ol>
  );
}

/**
 * One side of the console: which way it interprets, whether it is live, the key that starts
 * and stops it, and where its current sentence is. Everything that is set once (devices,
 * voice) is in the sheet behind "Devices and voice".
 *
 * Your side sits on the left and theirs, mirrored, on the right, each beside the end of the
 * surface (VoiceField) its voice enters from.
 */
export function ChannelPanel({ channel, onOpenDevices, onOpenGuide }: ChannelPanelProps) {
  const copy = CHANNEL_COPY[channel];
  const flow = useFlow(channel);
  const capture = useAppStore((state) => state.channels[channel].capture);
  const speaking = useAppStore((state) => state.channels[channel].speaking);
  const pushToTalk = useAppStore(
    (state) => channel === 'outgoing' && state.settings.outgoing.micMode === 'push-to-talk',
  );
  const live = capture === 'capturing';
  const Icon = channel === 'outgoing' ? Mic : MonitorSpeaker;

  return (
    <section
      className={cx('module', `module--${channel}`, live && 'is-live', live && speaking && 'is-speaking')}
      aria-label={copy.title}
    >
      <div className="module__head">
        <h2 className="module__title">{flow}</h2>
        <div className="module__meta">
          <Lamp channel={channel} />
          <span className="module__who label">{copy.title}</span>
          <CaptureStatus channel={channel} />
        </div>
      </div>

      <div className="module__deck">
        <div className="module__keys">
          <button
            type="button"
            className={cx('key', live && 'is-live')}
            // The button's name is always the whole label; a phone shows its first word only.
            aria-label={live ? copy.stop : copy.start}
            disabled={capture === 'starting'}
            // Called directly in the click handler: browsers only open the microphone, the
            // sharing dialog and audio playback in response to a user action.
            onClick={() =>
              live ? controller().stopChannel(channel) : void controller().startChannel(channel)
            }
          >
            {capture === 'starting' ? (
              <Spinner />
            ) : live ? (
              <Square size={12} aria-hidden="true" />
            ) : (
              <Icon size={16} aria-hidden="true" />
            )}
            <span className="key__full">{live ? copy.stop : copy.start}</span>
            <span className="key__short">{live ? SHORT_KEY[channel].stop : SHORT_KEY[channel].start}</span>
          </button>
          <button
            type="button"
            className="icon-button module__devices"
            title="Devices and voice"
            onClick={onOpenDevices}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span className="module__devices-label">Devices and voice</span>
          </button>
        </div>
        <div className="module__signal">
          <Pipeline channel={channel} />
          <LevelMeter channel={channel} />
          <Activity channel={channel} />
        </div>
      </div>

      <div className="module__extras">
        {pushToTalk && live ? <HoldToTalk /> : null}
        <RoutingNote channel={channel} onOpenGuide={onOpenGuide} />
      </div>
    </section>
  );
}

interface DevicesSheetProps {
  channel: ChannelId;
  open: boolean;
  onClose: () => void;
  overlay?: ReactNode;
}

/** A channel's devices and voice, in a sheet along the right edge, with the live level on top. */
export function DevicesSheet({ channel, open, onClose, overlay }: DevicesSheetProps) {
  const copy = CHANNEL_COPY[channel];
  const flow = useFlow(channel);
  const labelsAvailable = useAppStore((state) => state.devices.labelsAvailable);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="sheet"
      title="Devices and voice"
      subtitle={`${copy.title} · ${flow}`}
      icon={<SlidersHorizontal size={18} aria-hidden="true" />}
      overlay={overlay}
    >
      <div className="stack">
        <div className={cx('sheet-monitor', `sheet-monitor--${channel}`)}>
          <LevelMeter channel={channel} />
          <CaptureStatus channel={channel} />
        </div>
        {channel === 'outgoing' ? <OutgoingControls /> : <IncomingControls />}
        {!labelsAvailable ? (
          <div>
            <button
              type="button"
              className="button button--small"
              onClick={() => void controller().unlockDeviceLabels()}
            >
              Show device names
            </button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
