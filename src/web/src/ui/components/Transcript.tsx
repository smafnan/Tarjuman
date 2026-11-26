import { ArrowDown, Download, Keyboard, Volume2 } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { useShallow } from 'zustand/react/shallow';

import { isLangCode, LANGUAGES, type LangCode } from '../../../../shared/languages';
import type { DropReason } from '../../../../shared/protocol';
import { useAppStore } from '../../state/store';
import type { TranscriptEntry, TranscriptExportFormat } from '../../state/types';
import { controller } from '../controller';
import { useDismissable } from '../hooks/useDismissable';
import { useSmoothScroll } from '../hooks/useSmoothScroll';
import { isFinished } from '../lib/announce';
import { CHANNEL_COPY } from '../lib/channels';
import { cx } from '../lib/cx';
import { formatClock, formatSeconds } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import { restingPlace, settleOffset, type Rest, type Sentence } from '../lib/reading';
import { Interlude } from './Interlude';
import { LangText } from './LangText';
import { RevealLines } from './RevealLines';

/** How far short of its resting place the view still counts as "following the conversation". */
const FOLLOW_THRESHOLD_PX = 80;
/** How near the start of a sentence a view that coasts to a stop is eased onto it (lib/reading). */
const SNAP_REACH_PX = 44;
/** Above this, the delay is long enough to be worth pointing out. */
const SLOW_LATENCY_MS = 4_000;

/** The languages sit side by side only when each column gets at least this much width. */
const COLUMN_MIN_PX = 300;
/** Must match --gutter and --column-gap in layout.css. */
const GUTTER_PX = 92;
const COLUMN_GAP_PX = 32;

const DROP_TEXT: Record<DropReason, string> = {
  no_speech: 'No speech detected — ignored',
  hallucination: 'Not speech — ignored',
  too_short: 'Too short — ignored',
  too_long: 'Too long — ignored',
  cancelled: 'Cancelled',
};

/**
 * Where each language goes when the languages sit side by side: theirs on the left, the
 * extra captions in the middle, mine on the right. The same place for every sentence,
 * whoever spoke it, so each language can be read down its own column.
 */
interface Columns {
  langs: readonly LangCode[];
  /** Grid column of each language; column 1 is the gutter with the speaker and the time. */
  at: Partial<Record<LangCode, number>>;
}

function useColumns(): Columns {
  const { mine, theirs, captions } = useAppStore(
    useShallow((state) => ({
      mine: state.settings.session.channels.outgoing.sourceLang,
      theirs: state.settings.session.channels.outgoing.targetLang,
      // A string, so that rewriting the settings (every slider step) keeps the same columns.
      captions: state.settings.session.captionLangs.join(','),
    })),
  );
  return useMemo(() => {
    const extra = captions
      .split(',')
      .filter((lang): lang is LangCode => isLangCode(lang) && lang !== mine && lang !== theirs);
    const langs = [theirs, ...extra, mine];
    const at: Partial<Record<LangCode, number>> = {};
    langs.forEach((lang, index) => {
      at[lang] = index + 2;
    });
    return { langs, at };
  }, [mine, theirs, captions]);
}

/** The sentences as they are laid out, in the terms of lib/reading. */
function layoutOf(items: HTMLElement): Sentence[] {
  return Array.from(items.children, (entry) => {
    const sentence = entry as HTMLElement;
    return {
      top: sentence.offsetTop,
      height: sentence.offsetHeight,
      unwritten: sentence.classList.contains('is-unwritten'),
    };
  });
}

/** The line where words are about to be set, with a light running along it, while speech is
    being recognised or translated. */
function Pending() {
  return <span className="pending" aria-hidden="true" />;
}

interface EntryProps {
  entry: TranscriptEntry;
  columns: Columns;
  /** True once the conversation has been shown: only translations arriving after that rise in. */
  armed: RefObject<boolean>;
}

const Entry = memo(function Entry({ entry, columns, armed }: EntryProps) {
  const copy = CHANNEL_COPY[entry.channel];
  const speaker = (
    <span className="speaker">
      <span className="nuqta" aria-hidden="true" />
      {copy.tag}
    </span>
  );
  const time = (
    <time className="entry__time" dateTime={new Date(entry.createdAt).toISOString()}>
      {formatClock(entry.createdAt)}
    </time>
  );

  if (entry.status === 'dropped') {
    if (!entry.sourceText) return null;
    return (
      <li className={`entry entry--${entry.channel} entry--muted`}>
        <div className="entry__meta">
          {speaker}
          {time}
        </div>
        <p className="entry__dropped">{DROP_TEXT[entry.dropReason ?? 'hallucination']}</p>
      </li>
    );
  }

  const target = entry.translations[entry.targetLang];
  const extras = (Object.keys(entry.translations) as LangCode[]).filter(
    (lang) => lang !== entry.targetLang && lang !== entry.sourceLang && entry.translations[lang],
  );
  const working = !isFinished(entry.status);
  // A sentence in a language without a column (the pair was changed since) runs across all of them.
  const loose = columns.at[entry.sourceLang] === undefined || columns.at[entry.targetLang] === undefined;
  const place = (lang: LangCode): { className?: string; style?: CSSProperties } => {
    const column = loose ? undefined : columns.at[lang];
    return column === undefined
      ? { className: 'entry__wide' }
      : { style: { '--col': column } as CSSProperties };
  };
  const source = place(entry.sourceLang);
  const translation = place(entry.targetLang);

  return (
    <li
      // Unwritten: nothing to read on it yet, so it does not turn the page (Transcript).
      className={cx(
        'entry',
        `entry--${entry.channel}`,
        working && !entry.sourceText && !target && 'is-unwritten',
      )}
      aria-hidden={working ? true : undefined}
    >
      <div className="entry__meta">
        {speaker}
        <span className="entry__when">
          {time}
          {entry.typed ? (
            <span title="Typed">
              <Keyboard size={13} aria-label="Typed" />
            </span>
          ) : null}
          {entry.status === 'speaking' ? (
            <Volume2 size={13} aria-label="Speaking" className="entry__speaking" />
          ) : null}
        </span>
        {entry.latencyMs !== null ? (
          <span
            className={cx('entry__latency', entry.latencyMs > SLOW_LATENCY_MS && 'is-slow')}
            title="Time from the end of the sentence until the translated voice started"
          >
            {formatSeconds(entry.latencyMs)}
          </span>
        ) : null}
        <span className="entry__edge" aria-hidden="true" />
      </div>

      {entry.sourceText ? (
        <LangText
          lang={entry.sourceLang}
          as="p"
          className={cx('entry__source entry__cell', source.className)}
          style={source.style}
        >
          {entry.sourceText}
        </LangText>
      ) : (
        <p
          className={cx('entry__source entry__cell', source.className)}
          style={source.style}
          dir={LANGUAGES[entry.sourceLang].dir}
        >
          <Pending /> <span className="visually-hidden">Listening…</span>
        </p>
      )}

      {target ? (
        <LangText
          lang={entry.targetLang}
          as="p"
          className={cx('entry__target entry__cell', translation.className)}
          style={translation.style}
        >
          <RevealLines text={target} armed={armed} mixed={LANGUAGES[entry.targetLang].script === 'Arab'} />
        </LangText>
      ) : entry.status === 'translating' ? (
        <p
          className={cx('entry__target entry__cell', translation.className)}
          style={translation.style}
          dir={LANGUAGES[entry.targetLang].dir}
        >
          <Pending />
        </p>
      ) : null}

      {extras.map((lang) => {
        const at = place(lang);
        return (
          <LangText
            key={lang}
            lang={lang}
            as="p"
            className={cx('entry__extra entry__cell', at.className)}
            style={at.style}
          >
            <span className="entry__lang">{LANGUAGES[lang].code}</span>
            {entry.translations[lang]}
          </LangText>
        );
      })}

      {entry.status === 'error' ? (
        <p className="entry__error entry__wide">{entry.error ?? 'Something went wrong.'}</p>
      ) : null}
      {entry.status !== 'error' && entry.error ? (
        <p className="entry__note entry__wide">{entry.error}</p>
      ) : null}
    </li>
  );
});

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, wrap, close);
  const choose = (format: TranscriptExportFormat) => () => {
    setOpen(false);
    controller().exportTranscript(format);
  };
  return (
    <div className="menu" ref={wrap}>
      <button
        type="button"
        className="button button--quiet button--small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Download size={14} aria-hidden="true" /> Export
      </button>
      {open ? (
        <div className="menu__list" role="menu">
          <button type="button" role="menuitem" onClick={choose('markdown')}>
            Markdown
          </button>
          <button type="button" role="menuitem" onClick={choose('text')}>
            Plain text
          </button>
          <button type="button" role="menuitem" onClick={choose('json')}>
            JSON
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Toolbar({ hasEntries, extra }: { hasEntries: boolean; extra?: ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="toolbar">
      <h2 className="toolbar__title">Conversation</h2>
      {extra}
      <div className="toolbar__actions">
        <button
          type="button"
          className="button button--quiet button--small"
          title="Forget the conversation context used for translation"
          onClick={() => controller().resetContext()}
        >
          New topic
        </button>
        <ExportMenu />
        {confirming ? (
          <>
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => {
                setConfirming(false);
                controller().clearTranscript();
              }}
            >
              Clear everything
            </button>
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--quiet button--small"
            disabled={!hasEntries}
            onClick={() => setConfirming(true)}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

interface TranscriptProps {
  onOpenGuide: () => void;
  /** Extra controls beside the title (the demo's replay button). */
  toolbarExtra?: ReactNode;
}

export function Transcript({ onOpenGuide, toolbarExtra }: TranscriptProps) {
  const transcript = useAppStore((state) => state.transcript);
  const columns = useColumns();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const lenis = useSmoothScroll(scroller, content);
  const following = useRef(true);
  const lastTop = useRef(0);
  const shown = useRef(false);
  const armed = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const [width, setWidth] = useState(0);
  const parallel = width >= GUTTER_PX + columns.langs.length * (COLUMN_MIN_PX + COLUMN_GAP_PX);
  const empty = transcript.length === 0;

  // The drawing of an empty page stays a moment after the first sentence arrives, to step
  // back out of the way; it is drawn again whenever the conversation is cleared.
  const [interlude, setInterlude] = useState(empty);
  if (empty && !interlude) setInterlude(true);
  const interludeLeft = useCallback(() => setInterlude(false), []);
  // The first sentence takes over from the drawing: it waits for it to step back (layout.css).
  // The mark stays until that sentence is in, so that its arrival is never cut short.
  const [handover, setHandover] = useState(false);
  if (interlude && !empty && !handover) setHandover(true);
  useEffect(() => {
    if (!handover) return;
    const done = window.setTimeout(() => setHandover(false), 1600);
    return () => window.clearTimeout(done);
  }, [handover]);

  // A conversation that is there in the page's first moments was loaded with it: its sentences
  // arrive one after another behind the rest of the page (the delays are in layout.css).
  // Anything later is live and must appear at once.
  // The focus that follows the pointer (one sentence, or one language's column: layout.css)
  // lasts only while the pointer is in use. A pointer left resting on the conversation during
  // a call must not keep the other sentences dimmed, so the mark is cleared after a pause.
  const pointerRest = useRef(0);
  const pointerGone = useCallback(() => {
    window.clearTimeout(pointerRest.current);
    scroller.current?.removeAttribute('data-pointer');
  }, []);
  const pointerInUse = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    el.setAttribute('data-pointer', '');
    window.clearTimeout(pointerRest.current);
    pointerRest.current = window.setTimeout(() => el.removeAttribute('data-pointer'), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(pointerRest.current), []);

  const [arriving, setArriving] = useState(true);
  /** The page has finished arriving: from then on the conversation moves, it does not jump. */
  const arrived = useRef(false);
  useEffect(() => {
    if (!arriving) return;
    const settled = window.setTimeout(
      () => {
        arrived.current = true;
        setArriving(false);
      },
      empty ? 1200 : 3400,
    );
    return () => window.clearTimeout(settled);
  }, [empty, arriving]);

  /** Where the view rests while it follows the conversation (whole sentences: see lib/reading). */
  const restAt = useRef(0);

  const measureRest = useCallback((): Rest => {
    const el = scroller.current;
    const items = list.current;
    if (!el || !items) return { at: 0, room: 0 };
    const rest = restingPlace(layoutOf(items), {
      height: el.clientHeight,
      inset: el.querySelector<HTMLElement>('.transcript__heads')?.offsetHeight ?? 0,
      air: parseFloat(getComputedStyle(el).paddingBottom),
    });
    restAt.current = rest.at;
    return rest;
  }, []);

  /** Leaves under the newest sentence the room it takes to scroll as far as the resting place. */
  const leaveRoom = useCallback((room: number) => {
    // Under the list, not the page, so that the rules between the columns run through it.
    if (list.current) list.current.style.paddingBottom = room > 0 ? `${room}px` : '';
  }, []);

  /** Brings the resting place up to date without moving the view (the reader is looking back). */
  const restOnWholeSentences = useCallback(() => {
    leaveRoom(measureRest().room);
  }, [measureRest, leaveRoom]);

  /** Where a glide to the resting place is heading while it is on its way. */
  const glidingTo = useRef<number | null>(null);
  /** The room to leave once a glide up to the resting place has arrived. */
  const roomOnArrival = useRef<number | null>(null);

  const showEnd = useCallback(
    (smooth: boolean) => {
      const el = scroller.current;
      if (!el) return;
      const rest = measureRest();
      const to = rest.at;
      const smoother = lenis.current;
      if (!smoother) {
        leaveRoom(rest.room);
        el.scrollTo({ top: to, behavior: smooth ? 'smooth' : 'auto' });
        return;
      }
      const underWay = glidingTo.current;
      // One heading elsewhere turns towards the new place instead of jumping to it.
      const glide = smooth || underWay !== null;
      // Less room at once would have the browser pull the view up to the new end by itself.
      // When the view has to rise, the room it stands on goes only once it has arrived.
      const rising = glide && to < el.scrollTop - 1;
      roomOnArrival.current = rising ? rest.room : null;
      if (!rising) leaveRoom(rest.room);
      // A glide already heading for this very place is left to arrive: aimed again, it surges.
      if (underWay === to) return;
      glidingTo.current = glide ? to : null;
      // The new sentence is not in the smoother's measurements until it is told.
      smoother.resize();
      smoother.scrollTo(to, {
        immediate: !glide,
        duration: 0.9,
        force: true,
        onComplete: () => {
          glidingTo.current = null;
          if (roomOnArrival.current !== null) leaveRoom(roomOnArrival.current);
          roomOnArrival.current = null;
        },
      });
    },
    [lenis, measureRest, leaveRoom],
  );

  const scrollToEnd = useCallback(
    (smooth: boolean) => {
      showEnd(smooth && !prefersReducedMotion());
      following.current = true;
      setShowJump(false);
    },
    [showEnd],
  );

  // The width decides between stacked languages and columns. Measured once before the first
  // paint (an observer reports a frame late, which would flash the other layout), then on
  // every change of size.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      setWidth(Math.round(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measure();
      // Whatever changes the height of the page or of the sentences on it (a message strip
      // opening or closing above, a lower window, larger captions, a font arriving) must not
      // leave the newest sentence out of view while the reader is following the conversation.
      // While the page itself is still arriving the view is simply put right; after that it
      // glides to its new place like every other movement of the conversation.
      if (!shown.current) return;
      if (following.current) showEnd(arrived.current && !prefersReducedMotion());
      else restOnWholeSentences();
    });
    observer.observe(el);
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, [showEnd, restOnWholeSentences]);

  // Sentences that arrive together (restored, or loaded at once) are simply there; only those
  // arriving after the first of them rise in. This runs after the entries' own effects, so the
  // batch that first fills the page still sees it unarmed.
  useLayoutEffect(() => {
    if (transcript.length > 0) armed.current = true;
  }, [transcript]);

  // Keep the newest sentence in view, unless the reader has scrolled up to look at something.
  // The first sentences on the page are shown at once, later ones glide into view.
  // An empty page has nothing to follow: it opens at the top, where its drawing begins.
  useLayoutEffect(() => {
    if (transcript.length === 0) {
      restOnWholeSentences();
      glidingTo.current = null;
      roomOnArrival.current = null;
      lenis.current?.scrollTo(0, { immediate: true, force: true });
      scroller.current?.scrollTo({ top: 0 });
      following.current = true;
      shown.current = false;
      return;
    }
    if (following.current) {
      scrollToEnd(shown.current);
    } else {
      // The resting place is kept up to date even while the reader looks back: it is what
      // scrolling down again is measured against.
      restOnWholeSentences();
      setShowJump(true);
    }
    shown.current = true;
  }, [transcript, parallel, scrollToEnd, restOnWholeSentences, lenis]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Only a scroll that coasts (wheel, trackpad) is eased to a rest. A finger or a dragged
    // scrollbar puts the view exactly where the reader wants it, and it stays there.
    let coasting = false;
    let rest = 0;
    const settle = () => {
      if (prefersReducedMotion()) return;
      if (following.current) {
        // Just short of the resting place is following too: the view goes the rest of the way.
        if (restAt.current - el.scrollTop > 1) scrollToEnd(true);
        return;
      }
      const items = list.current;
      if (!items) return;
      const inset = el.querySelector<HTMLElement>('.transcript__heads')?.offsetHeight ?? 0;
      const offset = settleOffset(layoutOf(items), el.scrollTop, inset, SNAP_REACH_PX);
      if (offset === 0) return;
      const top = el.scrollTop + offset;
      const smoother = lenis.current;
      if (smoother) smoother.scrollTo(top, { duration: 0.6 });
      else el.scrollTo({ top, behavior: 'smooth' });
    };
    const onScroll = () => {
      const nearEnd = el.scrollTop > restAt.current - FOLLOW_THRESHOLD_PX;
      // Scrolling up is the reader looking back. A smooth scroll to the newest sentence only
      // ever moves down, so it never counts as that, even while it is still on its way.
      if (nearEnd) following.current = true;
      else if (el.scrollTop < lastTop.current - 1) following.current = false;
      lastTop.current = el.scrollTop;
      if (following.current) setShowJump(false);
      if (!coasting) return;
      window.clearTimeout(rest);
      rest = window.setTimeout(settle, 180);
    };
    // Either hand taking over ends a glide that was on its way to the end.
    const onWheel = () => {
      coasting = true;
      glidingTo.current = null;
    };
    const onHold = () => {
      coasting = false;
      glidingTo.current = null;
      window.clearTimeout(rest);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('pointerdown', onHold, { passive: true });
    return () => {
      window.clearTimeout(rest);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onHold);
    };
  }, [lenis, scrollToEnd]);

  return (
    <>
      <Toolbar hasEntries={!empty} extra={toolbarExtra} />
      <div
        className={cx('transcript', parallel && 'is-parallel')}
        style={{ '--cols': columns.langs.length } as CSSProperties}
      >
        <div
          className="transcript__scroll"
          ref={scroller}
          onPointerMove={pointerInUse}
          onPointerLeave={pointerGone}
        >
          <div className="transcript__content" ref={content}>
            {parallel && !empty ? (
              <div className="transcript__heads" aria-hidden="true">
                <div className="transcript__heads-row">
                  <span />
                  {columns.langs.map((lang) => (
                    <span key={lang} className="transcript__head" data-lang={lang}>
                      <span className="transcript__code">{LANGUAGES[lang].code}</span>
                      <LangText lang={lang} className="transcript__name">
                        {LANGUAGES[lang].nativeName}
                      </LangText>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {interlude ? (
              <Interlude
                langs={columns.langs}
                parallel={parallel}
                leaving={!empty}
                onLeft={interludeLeft}
                onOpenGuide={onOpenGuide}
              />
            ) : null}
            {/* Always in the document: a live region only announces changes made after it exists. */}
            <ol
              ref={list}
              className={cx('transcript__list', arriving && 'is-arriving', handover && 'is-handover')}
              role="log"
              aria-label="Conversation"
              aria-live="polite"
              aria-relevant="additions"
            >
              {transcript.map((entry) => (
                <Entry key={entry.id} entry={entry} columns={columns} armed={armed} />
              ))}
            </ol>
          </div>
        </div>
        {showJump && !empty ? (
          <button
            type="button"
            className="button button--primary button--small jump"
            onClick={() => scrollToEnd(true)}
          >
            <ArrowDown size={14} aria-hidden="true" /> Jump to latest
          </button>
        ) : null}
      </div>
    </>
  );
}
