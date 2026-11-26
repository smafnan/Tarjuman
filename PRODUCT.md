# Product

<!-- impeccable:product-schema 1 -->

Inferred on 2026-11-26 from README.md, AGENTS.md and docs/ARCHITECTURE.md; the owner asked to skip the
interview. Correct anything that is wrong.

## Platform

web

## Users

An Urdu speaker taking part in Microsoft Teams calls with German speakers. They run Tarjuman in a
browser window beside Teams for the length of a meeting: they speak Urdu, hear the other side in
Urdu, and glance at the captions while they talk.

## Product Purpose

A live voice interpreter for Teams calls. What the user says in Urdu is spoken to the other side in
German through a virtual microphone; what the other side says in German is spoken to the user in
Urdu; both directions are captioned, with English as an extra caption language. Success: the
conversation keeps flowing, each sentence arrives within a couple of seconds, and the user never has
to wonder whether their microphone is live.

## Positioning

Runs on the user's own machine with free tiers of speech and translation providers behind a fallback
chain: no account, keys stay local, nothing is logged.

## Operating Context

- Used during live calls, often half covered by or beside the Teams window; glanced at, not studied.
- Browsers slow timers when the window is hidden, so nothing on the capture path may depend on them.
- Microphone capture, browser-tab or device capture of the other side, and a virtual audio cable that
  Teams uses as its microphone.

## Capabilities and Constraints

- Two channels: outgoing (you speak) and incoming (they speak), each started with one action;
  push-to-talk as an option for the microphone.
- A transcript with captions in Urdu, German and English, side by side when the window is wide;
  export, new topic, clear; typing instead of speaking.
- Settings for keys, languages, audio and appearance (theme, Urdu typeface, caption size); a setup
  guide for Teams.
- Languages: Urdu (Nastaliq by default, Naskh by setting), German, English.
- No third-party assets at run time; meeting content and keys are never logged.

## Brand Commitments

- Name: Tarjuman (ترجمان, "interpreter"). Mark: the letter ت with its two dots, one per voice.
- A warm colour is the user's own voice and a cold one the other side, everywhere the two appear.
- The owner wants the interface dark and futuristic, with slow arrivals, motion graphics and
  hover behaviour, and nothing that reads as a generated template (2026-11-26).

## Evidence on Hand

No customer quotes, figures or testimonials exist. The demo data (`?demo=1`) is synthetic.

## Product Principles

1. Captions first: the legibility of every sentence outranks decoration.
2. State is unmistakable: whether each channel is live reads from across the room.
3. Never in the way: motion and expression never delay or hide the conversation.
4. Local and private by default.

## Accessibility & Inclusion

WCAG 2.1 AA contrast (enforced by a token test), full keyboard operation, reduced motion honoured, a
screen-reader live region for new captions, right-to-left Urdu.
