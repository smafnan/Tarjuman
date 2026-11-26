import { ArrowLeftRight, BookOpen, Settings } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { LANGUAGES } from '../../../../shared/languages';
import type { ProviderKind } from '../../../../shared/protocol';
import { useAppStore } from '../../state/store';
import type { ConnectionState } from '../../state/types';
import { controller } from '../controller';
import { useDismissable } from '../hooks/useDismissable';
import { useNow } from '../hooks/useNow';
import { formatCountdown } from '../lib/format';
import { shiftIntoViewport } from '../lib/geometry';
import {
  inFallbackOrder,
  PROVIDER_KIND_LABEL,
  PROVIDER_STATE_LABEL,
  summarizeChain,
  type ChainSummary,
} from '../lib/providers';
import { BrandMark } from './BrandMark';

const CONNECTION: Record<ConnectionState, { label: string; dot: string }> = {
  connected: { label: 'Connected', dot: 'dot--ok' },
  connecting: { label: 'Connecting…', dot: 'dot--warn' },
  reconnecting: { label: 'Reconnecting…', dot: 'dot--warn' },
  disconnected: { label: 'Disconnected', dot: 'dot--danger' },
};

const TONE_DOT = { ok: 'dot--ok', warn: 'dot--warn', danger: 'dot--danger', unknown: '' } as const;

const KINDS: readonly ProviderKind[] = ['stt', 'mt', 'tts'];

/** What the bar says about a step that cannot work right now; nothing while it can. */
function problemText(summary: ChainSummary, now: number): string | null {
  if (summary.tone === 'warn') {
    return summary.cooldownUntil
      ? `Cooling down · ${formatCountdown(summary.cooldownUntil - now)}`
      : 'Cooling down';
  }
  if (summary.tone === 'danger') return 'Needs a key';
  return null;
}

/**
 * The three steps (recognition, translation, voice) as one quiet control: a dot each while
 * all is well, words only for the step that has a problem. The list behind it shows every
 * provider in the order they are tried.
 */
function Services() {
  const providers = useAppStore((state) => state.providers);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, wrap, close);

  // Anchored to its button, which can sit anywhere in a wrapped top bar; slide the list back
  // into the window instead of letting it run off an edge.
  useLayoutEffect(() => {
    const element = popover.current;
    if (!open || !element) return;
    const fit = () => {
      element.style.translate = '0';
      const box = element.getBoundingClientRect();
      const shift = shiftIntoViewport(box.left, box.right, document.documentElement.clientWidth, 8);
      element.style.translate = `${shift}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);

  const summaries = KINDS.map((kind) => ({ kind, summary: summarizeChain(providers[kind]) }));
  const counting = summaries.some(({ summary }) => summary.tone === 'warn' && summary.cooldownUntil !== null);
  const now = useNow(counting || open);

  return (
    <div className="services" ref={wrap}>
      <button
        type="button"
        className="services__button"
        aria-expanded={open}
        title="Which service does each step"
        onClick={() => setOpen((value) => !value)}
      >
        {summaries.map(({ kind, summary }) => {
          const problem = problemText(summary, now);
          return (
            <span key={kind} className={`service service--${summary.tone}`}>
              <span className={`dot ${TONE_DOT[summary.tone]}`} aria-hidden="true" />
              <span className="service__label">{PROVIDER_KIND_LABEL[kind]}</span>
              {problem ? (
                <span className="service__problem">{problem}</span>
              ) : (
                <span className="visually-hidden">{summary.active ? ' ready' : ' not known yet'}</span>
              )}
            </span>
          );
        })}
      </button>
      {open ? (
        <div className="popover" ref={popover} role="dialog" aria-label="Services">
          {summaries.map(({ kind }) => (
            <section key={kind} className="popover__section" aria-label={PROVIDER_KIND_LABEL[kind]}>
              <h3 className="popover__title">
                {PROVIDER_KIND_LABEL[kind]}
                <span className="popover__note">tried in this order</span>
              </h3>
              {providers[kind].length === 0 ? (
                <p className="muted small">Not known until the server answers.</p>
              ) : (
                <ol className="chain">
                  {inFallbackOrder(providers[kind]).map((provider) => (
                    <li key={provider.id} className="chain__item">
                      <span
                        className={`dot ${provider.state === 'ready' ? 'dot--ok' : provider.state === 'cooldown' ? 'dot--warn' : ''}`}
                        aria-hidden="true"
                      />
                      <span className="chain__name">
                        {provider.label}
                        <code className="chain__id" title="Provider id, as used in the .env file">
                          {provider.id}
                        </code>
                      </span>
                      <span className="chain__state">
                        {provider.state === 'cooldown' && provider.cooldownUntil
                          ? `${PROVIDER_STATE_LABEL.cooldown} · ${formatCountdown(provider.cooldownUntil - now)}`
                          : PROVIDER_STATE_LABEL[provider.state]}
                      </span>
                      {provider.detail && provider.state !== 'unconfigured' ? (
                        <span className="chain__detail">{provider.detail}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface HeaderProps {
  onOpenGuide: () => void;
  onOpenSettings: () => void;
}

export function Header({ onOpenGuide, onOpenSettings }: HeaderProps) {
  const connection = useAppStore((state) => state.connection);
  const pair = useAppStore(
    useShallow((state) => ({
      mine: state.settings.session.channels.outgoing.sourceLang,
      theirs: state.settings.session.channels.outgoing.targetLang,
    })),
  );

  return (
    <header className="topbar">
      <h1 className="brand">
        <BrandMark className="brand__mark" />
        <span className="brand__name">Tarjuman</span>
      </h1>

      <div className="pair">
        <span>
          {LANGUAGES[pair.mine].name} ⇄ {LANGUAGES[pair.theirs].name}
        </span>
        <button
          type="button"
          className="icon-button"
          title="Swap who speaks which language"
          aria-label="Swap who speaks which language"
          onClick={() => controller().swapLanguages()}
        >
          <ArrowLeftRight size={15} aria-hidden="true" />
        </button>
      </div>

      <span className="topbar__spacer" />

      <span className="connection" role="status">
        <span className={`dot ${CONNECTION[connection].dot}`} aria-hidden="true" />
        <span className="connection__label">{CONNECTION[connection].label}</span>
      </span>

      <Services />

      <div className="topbar__actions">
        <button type="button" className="button" title="Setup guide" onClick={onOpenGuide}>
          <BookOpen size={16} aria-hidden="true" />
          <span className="button__label">Setup guide</span>
        </button>
        <button type="button" className="button" title="Settings" onClick={onOpenSettings}>
          <Settings size={16} aria-hidden="true" />
          <span className="button__label">Settings</span>
        </button>
      </div>
    </header>
  );
}
