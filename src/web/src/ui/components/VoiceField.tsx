import { useEffect, useRef } from 'react';

import type { ChannelId } from '../../../../shared/settings';
import { useAppStore } from '../../state/store';
import { prefersReducedMotion } from '../lib/motion';

/** The surface is a grid of heights: columns across the console, rows from far to near. */
const COLS = 132;
const ROWS = 30;
const CELLS = COLS * ROWS;
/** Squared wave speed in cells per step; the scheme is stable below 0.5 in two dimensions. */
const SPEED = 0.22;
/** Share of its motion every cell loses per step: little, so a voice reaches the middle. */
const DAMPING = 0.0045;
/** Extra loss towards the two ends, where waves leave; the near and far edges reflect, so the
    surface carries a wave along its length like a channel. */
const END_LOSS = 0.22;
/** Extra loss a voice meets beyond the middle of the surface, where the other voice's side begins. */
const REACH_LOSS = 0.055;
/** Where each voice enters: columns from its own end, on the row in the middle distance. */
const SOURCE_INSET = 9;
const SOURCE_ROW = Math.round(ROWS * 0.52);
/** How much nearer rows spread apart: the surface is seen at a low angle. */
const PERSPECTIVE = 2.05;
/** Height of one unit of displacement on the nearest row, in CSS pixels. */
const RELIEF = 26;
/** Seconds the surface takes to appear when the page opens. */
const ARRIVAL_S = 3.2;
/** Columns a crossing sentence's crest travels per step: the whole surface in under two seconds. */
const CROSSING_SPEED = 1.25;
/** Colour stops across the surface; the colour follows the waves between them. */
const STOPS = 24;

const CHANNELS: readonly ChannelId[] = ['outgoing', 'incoming'];

type Rgb = [number, number, number];

interface Field {
  cur: Float32Array;
  prev: Float32Array;
}

/** A sentence on its way across: a single crest from the speaker's end to the listener's. */
interface Crossing {
  from: ChannelId;
  at: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The two voices as waves on one surface. Your voice enters at the left end and theirs at the
 * right; each live level drives its end, and the waves run along the surface towards each
 * other. A wave carries its voice's colour with it, and where the two are on the same water
 * the lines turn white: that meeting is the interpreting. When a sentence has been
 * interpreted, one crest crosses from its speaker's end to the other. At rest a slow swell
 * keeps the surface from lying flat, and a pointer moving over it disturbs it.
 *
 * It is a simulation (the damped wave equation on a grid, one field per voice and one for the
 * pointer), drawn as ridgelines seen at a low angle with nearer rows hiding the ones behind.
 * The level meters stay the exact reading.
 */
export function VoiceField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    const host = canvas?.parentElement;
    if (!canvas || !ctx || !host) return;

    const still = prefersReducedMotion();
    const field = (): Field => ({ cur: new Float32Array(CELLS), prev: new Float32Array(CELLS) });
    const voice = { outgoing: field(), incoming: field() };
    const free = field();
    // Each voice fades out a little past the middle, so its water and the other's overlap
    // there and nowhere else: the louder voice never floods the whole surface.
    const freeLoss = new Float32Array(COLS);
    const voiceLoss = { outgoing: new Float32Array(COLS), incoming: new Float32Array(COLS) };
    for (let i = 0; i < COLS; i++) {
      const along = i / (COLS - 1);
      const ends = DAMPING + END_LOSS * (1 - smoothstep(0, 10, Math.min(i, COLS - 1 - i)));
      freeLoss[i] = ends;
      voiceLoss.outgoing[i] = ends + REACH_LOSS * smoothstep(0.48, 0.8, along);
      voiceLoss.incoming[i] = ends + REACH_LOSS * smoothstep(0.48, 0.8, 1 - along);
    }
    const source = { outgoing: SOURCE_INSET, incoming: COLS - 1 - SOURCE_INSET };
    const level = { outgoing: 0, incoming: 0 };
    const phase = { outgoing: 0, incoming: 1.3 };
    const lit = { outgoing: 0, incoming: 0 };
    /** How much of each voice is at each column right now; it decays as the wave passes on. */
    const presence = { outgoing: new Float32Array(COLS), incoming: new Float32Array(COLS) };
    const crossings: Crossing[] = [];
    const crest = new Float32Array(COLS);
    const ridge = new Float32Array(COLS);
    const seen = new Map<string, string>();

    let width = 0;
    let height = 0;
    let shown = false;
    let bandTop = 0;
    let bandBottom = 0;
    let frame = 0;
    let ticks = 0;
    let started = 0;
    let lastPointer = -1e9;
    let seed = 20261126;
    let pointer: { x: number; y: number } | null = null;
    const ink: { line: Rgb; you: Rgb; them: Rgb; ground: string } = {
      line: [233, 230, 223],
      you: [255, 106, 61],
      them: [159, 196, 255],
      ground: '#08090a',
    };

    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const parse = (colour: string, fallback: Rgb): Rgb => {
      const parts = colour.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return fallback;
      return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
    };

    // The canvas carries the colours as ordinary CSS properties, which resolve light-dark()
    // into plain colours it can paint with.
    const readInk = () => {
      const style = getComputedStyle(canvas);
      ink.line = parse(style.color, ink.line);
      ink.you = parse(style.borderLeftColor, ink.you);
      ink.them = parse(style.borderRightColor, ink.them);
      ink.ground = style.outlineColor || ink.ground;
    };

    // The surface lies between the two sides' titles and their controls, clear of both.
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      const head = host.querySelector('.module__head')?.getBoundingClientRect();
      const deck = host.querySelector('.module__deck')?.getBoundingClientRect();
      bandTop = head ? head.bottom - box.top + 12 : height * 0.3;
      bandBottom = deck ? deck.top - box.top - 14 : height * 0.74;
      if (bandBottom - bandTop < 24) bandBottom = bandTop + 24;
    };
    // The nearest row's relief follows the room there is, and the rows stop short of the
    // controls by that much, so even the tallest ridge stays inside the band.
    const nearRelief = () => Math.min(RELIEF, Math.max(9, (bandBottom - bandTop) * 0.2));
    const rowY = (j: number) =>
      bandTop + 3 + Math.pow(j / (ROWS - 1), PERSPECTIVE) * (bandBottom - bandTop - 3 - nearRelief() * 1.05);

    const poke = (target: Field, i: number, j: number, amount: number) => {
      if (i < 2 || i > COLS - 3 || j < 1 || j > ROWS - 2) return;
      const at = j * COLS + i;
      target.cur[at] = (target.cur[at] ?? 0) + amount;
      for (const near of [at - 1, at + 1, at - COLS, at + COLS]) {
        target.cur[near] = (target.cur[near] ?? 0) + amount * 0.5;
      }
    };

    /** One step of the damped wave equation. The near and far edges mirror, the ends absorb. */
    const step = (target: Field, loss: Float32Array) => {
      const { cur, prev } = target;
      for (let j = 0; j < ROWS; j++) {
        const up = j > 0 ? -COLS : COLS;
        const down = j < ROWS - 1 ? COLS : -COLS;
        for (let i = 1; i < COLS - 1; i++) {
          const at = j * COLS + i;
          const here = cur[at] ?? 0;
          const lap =
            (cur[at - 1] ?? 0) + (cur[at + 1] ?? 0) + (cur[at + up] ?? 0) + (cur[at + down] ?? 0) - 4 * here;
          prev[at] = here + (here - (prev[at] ?? 0)) * (1 - (loss[i] ?? 0)) + SPEED * lap;
        }
      }
      target.cur = prev;
      target.prev = cur;
    };

    const simulate = () => {
      const channels = useAppStore.getState().channels;
      for (const id of CHANNELS) {
        const runtime = channels[id];
        const live = runtime.capture === 'capturing';
        const target = live && !runtime.gated ? runtime.level : 0;
        // Quick to rise, slow to fall, like the ballistics of a meter.
        level[id] += (target - level[id]) * (target > level[id] ? 0.3 : 0.05);
        lit[id] += ((live ? 1 : 0) - lit[id]) * 0.04;
        phase[id] += 0.2 + level[id] * 0.05;
        step(voice[id], voiceLoss[id]);
        const push = Math.sin(phase[id]) * level[id] * 0.62;
        const at = SOURCE_ROW * COLS + source[id];
        const cur = voice[id].cur;
        cur[at] = (cur[at] ?? 0) + push;
        cur[at - COLS] = (cur[at - COLS] ?? 0) + push * 0.6;
        cur[at + COLS] = (cur[at + COLS] ?? 0) + push * 0.6;
        // Where this voice's water is moving now; the mark it leaves fades behind the wave.
        const there = presence[id];
        for (let i = 0; i < COLS; i++) {
          let most = 0;
          for (let j = 2; j < ROWS; j += 5) most = Math.max(most, Math.abs(cur[j * COLS + i] ?? 0));
          there[i] = Math.max((there[i] ?? 0) * 0.972, Math.min(1, most * 2.6));
        }
      }
      step(free, freeLoss);
      // A drop now and then keeps the surface alive while nobody speaks.
      if (ticks % 34 === 0) {
        poke(
          free,
          8 + Math.floor(random() * (COLS - 16)),
          3 + Math.floor(random() * (ROWS - 6)),
          (random() - 0.5) * 0.9,
        );
      }
      // Sentences on their way across.
      crest.fill(0);
      for (let n = crossings.length - 1; n >= 0; n--) {
        const crossing = crossings[n];
        if (!crossing) continue;
        crossing.at += crossing.from === 'outgoing' ? CROSSING_SPEED : -CROSSING_SPEED;
        const travelled =
          crossing.from === 'outgoing' ? crossing.at / (COLS - 1) : 1 - crossing.at / (COLS - 1);
        if (travelled >= 1) {
          crossings.splice(n, 1);
          continue;
        }
        // It lifts as it leaves and settles as it lands.
        const lift = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, travelled))), 0.55);
        const there = presence[crossing.from];
        for (let i = Math.max(0, Math.floor(crossing.at) - 12); i < Math.min(COLS, crossing.at + 12); i++) {
          const bump = Math.exp(-Math.pow((i - crossing.at) / 3.4, 2)) * lift;
          crest[i] = (crest[i] ?? 0) + bump * 1.15;
          there[i] = Math.max(there[i] ?? 0, bump);
        }
      }
    };

    /** The colour at one column: bone at rest, a voice's colour where its waves are, white where
        both are. A live side tints its own end faintly even while it is silent. */
    const colourAt = (i: number): string => {
      const near = { outgoing: Math.exp(-i / 22), incoming: Math.exp(-(COLS - 1 - i) / 22) };
      const you = Math.max(presence.outgoing[i] ?? 0, lit.outgoing * 0.5 * near.outgoing);
      const them = Math.max(presence.incoming[i] ?? 0, lit.incoming * 0.5 * near.incoming);
      const total = Math.min(1, you + them);
      const share = you + them > 0 ? you / (you + them) : 0.5;
      const meet = Math.min(you, them);
      const channel = (index: 0 | 1 | 2) => {
        const voiced = ink.you[index] * share + ink.them[index] * (1 - share);
        const base = ink.line[index] + (voiced - ink.line[index]) * total;
        return Math.round(base + (255 - base) * meet * 0.85);
      };
      const alpha = 0.76 + 0.24 * Math.max(total, meet);
      return `rgb(${channel(0)} ${channel(1)} ${channel(2)} / ${alpha.toFixed(3)})`;
    };

    const draw = (arrival: number, seconds: number) => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);
      const stepX = width / (COLS - 1);
      const stroke = ctx.createLinearGradient(0, 0, width, 0);
      for (let s = 0; s <= STOPS; s++) {
        stroke.addColorStop(s / STOPS, colourAt(Math.round((s / STOPS) * (COLS - 1))));
      }
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      const you = voice.outgoing.cur;
      const them = voice.incoming.cur;
      const loose = free.cur;
      for (let j = 0; j < ROWS; j++) {
        const depth = j / (ROWS - 1);
        // The surface arrives from the middle distance outwards.
        const shown = smoothstep(0, 0.35, arrival * 1.35 - Math.abs(depth - 0.5) * 2 * 0.9);
        if (shown <= 0) continue;
        const base = rowY(j);
        const relief = nearRelief() * (0.46 + 0.54 * depth) * (0.4 + 0.6 * arrival);
        const row = j * COLS;
        // The surface is never flat: a slow swell crosses it, like a sea at rest, and the
        // voices' ripples and the crossing crests ride on top of it. Heights have a soft
        // ceiling, so a loud voice makes steep ridges but never leaves the band.
        for (let i = 0; i < COLS; i++) {
          const swell =
            Math.sin(i * 0.118 + j * 0.34 + seconds * 0.5) * 0.36 +
            Math.sin(i * 0.049 - j * 0.22 - seconds * 0.31) * 0.42 +
            Math.sin(i * 0.262 + j * 0.13 + seconds * 0.74) * 0.14;
          const at = row + i;
          const lift = (you[at] ?? 0) + (them[at] ?? 0) + (loose[at] ?? 0) + (crest[i] ?? 0) + swell;
          ridge[i] = base - Math.tanh(lift * 0.85) * 1.2 * relief;
        }
        ctx.beginPath();
        ctx.moveTo(0, ridge[0] ?? base);
        for (let i = 1; i < COLS; i++) ctx.lineTo(i * stepX, ridge[i] ?? base);
        // Hide what lies behind this ridge: a band of ground just below the line.
        ctx.lineTo(width, base + relief + 12);
        ctx.lineTo(0, base + relief + 12);
        ctx.closePath();
        ctx.globalAlpha = 1;
        ctx.fillStyle = ink.ground;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, ridge[0] ?? base);
        for (let i = 1; i < COLS; i++) ctx.lineTo(i * stepX, ridge[i] ?? base);
        // Nearer ridges are brighter: the far ones fall away towards a horizon.
        ctx.globalAlpha = shown * (0.07 + 0.93 * Math.pow(depth, 1.5));
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
      // The surface dissolves at its horizon and at its near edge instead of ending in a cut.
      const fade = ctx.createLinearGradient(0, bandTop - 8, 0, bandBottom + 10);
      const span = bandBottom - bandTop + 18;
      fade.addColorStop(0, 'rgb(0 0 0 / 0)');
      fade.addColorStop(Math.min(0.45, 18 / span), 'rgb(0 0 0 / 1)');
      fade.addColorStop(Math.max(0.55, 1 - 12 / span), 'rgb(0 0 0 / 1)');
      fade.addColorStop(1, 'rgb(0 0 0 / 0)');
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // Not on the page (a window too low for it: layout.css): nothing to simulate or draw.
      if (!shown) return;
      ticks += 1;
      if (!started) started = now;
      const arrival = Math.min(1, (now - started) / 1000 / ARRIVAL_S);
      const busy =
        level.outgoing > 0.004 ||
        level.incoming > 0.004 ||
        crossings.length > 0 ||
        now - lastPointer < 2500 ||
        arrival < 1;
      // At rest a third of the frames is plenty; the surface only breathes then.
      if (!busy && ticks % 3 !== 0) return;
      if (ticks % 90 === 1) measure();
      if (ticks === 36) {
        poke(free, source.outgoing, SOURCE_ROW, 1.1);
        poke(free, source.incoming, SOURCE_ROW, 1.1);
      }
      simulate();
      draw(1 - Math.pow(1 - arrival, 3), now / 1000);
    };

    /** A still picture for reduced motion: the swell frozen, each live side tinting its end. */
    const settle = () => {
      const channels = useAppStore.getState().channels;
      for (const id of CHANNELS) lit[id] = channels[id].capture === 'capturing' ? 1 : 0;
      draw(1, 0);
    };

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      shown = width > 0 && height > 0;
      if (!shown) return;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      readInk();
      measure();
      if (still) settle();
    };

    // A pointer crossing the surface pushes it down where it passes, harder the faster it moves.
    const onMove = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      const next = { x: event.clientX - box.left, y: event.clientY - box.top };
      const last = pointer;
      pointer = next;
      if (!last) return;
      const along = Math.min(1, Math.max(0, (next.y - bandTop) / (bandBottom - bandTop)));
      const reach = Math.hypot(next.x - last.x, next.y - last.y);
      if (reach < 1) return;
      lastPointer = performance.now();
      poke(
        free,
        Math.round((next.x / width) * (COLS - 1)),
        Math.round(Math.pow(along, 1 / PERSPECTIVE) * (ROWS - 1)),
        -Math.min(0.9, reach * 0.045),
      );
    };
    const onLeave = () => {
      pointer = null;
    };
    const repaint = () => {
      readInk();
      if (still) settle();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const theme = new MutationObserver(repaint);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // A sentence that has just been interpreted (its translation starts to be spoken, or is
    // simply done when speaking is off) sends a crest across from its speaker's end. What is
    // already on the page when it opens sends nothing.
    let primed = false;
    const watch = (
      state: ReturnType<typeof useAppStore.getState>,
      previous?: ReturnType<typeof useAppStore.getState>,
    ) => {
      const transcript = state.transcript;
      for (let i = Math.max(0, transcript.length - 16); i < transcript.length; i++) {
        const entry = transcript[i];
        if (!entry) continue;
        const before = seen.get(entry.id);
        seen.set(entry.id, entry.status);
        if (!primed || before === entry.status || still) continue;
        const interpreted =
          entry.status === 'speaking' ||
          (entry.status === 'done' && before !== 'speaking' && before !== undefined);
        if (interpreted && crossings.length < 4) {
          crossings.push({ from: entry.channel, at: entry.channel === 'outgoing' ? 0 : COLS - 1 });
        }
      }
      if (seen.size > 64) {
        for (const id of [...seen.keys()].slice(0, seen.size - 32)) seen.delete(id);
      }
      primed = true;
      if (
        still &&
        previous &&
        CHANNELS.some((id) => state.channels[id].capture !== previous.channels[id].capture)
      ) {
        settle();
      }
    };
    watch(useAppStore.getState());
    const unsubscribe = useAppStore.subscribe(watch);

    if (!still) {
      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerleave', onLeave);
      frame = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      theme.disconnect();
      unsubscribe();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={ref} className="console__field" aria-hidden="true" />;
}
