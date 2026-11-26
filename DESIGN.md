---
name: Tarjuman
description: An instrument in a dark room, where two voices travel as waves on one surface and meet in the middle.
colors:
  carbon-ground: 'light-dark(#f0efeb, #08090a)'
  carbon-sheet: 'light-dark(#f7f6f3, #0b0c0e)'
  carbon-raised: 'light-dark(#e8e7e2, #131517)'
  carbon-lifted: 'light-dark(#dbdad4, #1c1e21)'
  border: 'light-dark(#d7d6cf, #212327)'
  border-strong: 'light-dark(#bbbab2, #33363b)'
  control-edge: 'light-dark(#7c7b74, #6f7379)'
  bone: 'light-dark(#111213, #e9e6df)'
  bone-muted: 'light-dark(#4c4c48, #a5a39c)'
  bone-faint: 'light-dark(#61615b, #86857f)'
  hairline: 'light-dark(rgb(0 0 0 / 0.08), rgb(255 255 255 / 0.09))'
  hairline-strong: 'light-dark(rgb(0 0 0 / 0.17), rgb(255 255 255 / 0.18))'
  ember-voice: 'light-dark(#b93a0f, #ff6a3d)'
  ember-field: 'light-dark(#c43b12, #ff6a3d)'
  frost-voice: 'light-dark(#1f4cae, #9fc4ff)'
  frost-field: 'light-dark(#2942b5, #9fc4ff)'
  on-voice: 'light-dark(#ffffff, #0a0a0b)'
  accent: 'light-dark(#111213, #e9e6df)'
  accent-contrast: 'light-dark(#ffffff, #0a0a0b)'
  accent-soft: 'light-dark(#e8e7e2, #1c1e21)'
  ok: 'light-dark(#1a7339, #62d691)'
  ok-soft: 'light-dark(#e1f1e6, #10291b)'
  warn: 'light-dark(#835800, #f2b84b)'
  warn-soft: 'light-dark(#f8edd2, #2c230d)'
  danger: 'light-dark(#b81c3c, #ff7d93)'
  danger-soft: 'light-dark(#fbe6ea, #33131c)'
typography:
  display:
    fontFamily: "'Roboto Flex Variable', 'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: 'clamp(24px, 2.75vw, 42px)'
    fontWeight: 280
    lineHeight: 1.05
    letterSpacing: '-0.012em'
    fontVariation: "'wdth' 128"
  wordmark:
    fontFamily: "'Roboto Flex Variable', 'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: 'clamp(24px, 2.9vw, 46px)'
    fontWeight: 250
    lineHeight: 1
    letterSpacing: '0.05em'
    fontVariation: "'wdth' 151, 'wght' 250"
  headline:
    fontFamily: "'Roboto Flex Variable', 'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: 'clamp(20px, 1.8vw, 26px)'
    fontWeight: 330
    lineHeight: 1.15
    letterSpacing: '-0.005em'
    fontVariation: "'wdth' 122"
  title:
    fontFamily: "'Roboto Flex Variable', 'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: '19px'
    fontWeight: 420
    lineHeight: 1.2
    letterSpacing: '0.01em'
    fontVariation: "'wdth' 122"
  section-title:
    fontFamily: "'Roboto Flex Variable', 'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: '15.5px'
    fontWeight: 430
    lineHeight: 1.3
    letterSpacing: '0.01em'
    fontVariation: "'wdth' 120"
  caption:
    fontFamily: "'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: '21px'
    fontWeight: 520
    lineHeight: 1.38
    letterSpacing: '-0.006em'
  caption-source:
    fontFamily: "'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: '15px'
    lineHeight: 1.5
  caption-urdu:
    fontFamily: "'Noto Nastaliq Urdu Variable', 'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', serif"
    fontSize: '23px'
    fontWeight: 500
    lineHeight: 2.1
    letterSpacing: '0'
  body:
    fontFamily: "'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: '14px'
    lineHeight: 1.5
  label:
    fontFamily: "'Roboto Flex Variable', 'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: '10.5px'
    fontWeight: 560
    lineHeight: 1.3
    letterSpacing: '0.18em'
    fontVariation: "'wdth' 135"
  key-label:
    fontFamily: "'Roboto Flex Variable', 'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: '11px'
    fontWeight: 560
    lineHeight: 1
    letterSpacing: '0.15em'
    fontVariation: "'wdth' 132"
  measurement:
    fontFamily: "'Martian Mono Variable', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1
    fontFeature: "'tnum', 'zero'"
  measurement-small:
    fontFamily: "'Martian Mono Variable', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: '10.5px'
    letterSpacing: '0.02em'
    fontFeature: "'tnum', 'zero'"
rounded:
  s: '2px'
  base: '2px'
  l: '3px'
spacing:
  page-x: '24px'
  page-x-compact: '14px'
  console-gap: '40px'
  gutter: '92px'
  column-gap: '32px'
components:
  button:
    textColor: '{colors.bone}'
    rounded: '{rounded.base}'
    padding: '6px 14px'
    height: '34px'
  button-hover:
    backgroundColor: '{colors.bone}'
    textColor: '{colors.carbon-ground}'
  button-primary:
    backgroundColor: '{colors.bone}'
    textColor: '{colors.carbon-ground}'
    rounded: '{rounded.base}'
    padding: '6px 14px'
    height: '34px'
  button-primary-hover:
    textColor: '{colors.bone}'
  button-danger:
    textColor: '{colors.danger}'
    rounded: '{rounded.base}'
  button-danger-hover:
    backgroundColor: '{colors.danger}'
    textColor: '{colors.carbon-ground}'
  button-quiet:
    textColor: '{colors.bone-muted}'
  button-quiet-hover:
    textColor: '{colors.bone}'
  button-small:
    padding: '3px 10px'
    height: '28px'
  icon-button:
    textColor: '{colors.bone-muted}'
    rounded: '{rounded.s}'
    size: '32px'
  icon-button-hover:
    backgroundColor: '{colors.carbon-lifted}'
    textColor: '{colors.bone}'
  key-you:
    textColor: '{colors.ember-voice}'
    typography: '{typography.key-label}'
    rounded: '{rounded.base}'
    padding: '8px 14px'
    width: '246px'
    height: '42px'
  key-you-live:
    backgroundColor: '{colors.ember-field}'
    textColor: '{colors.on-voice}'
  key-them:
    textColor: '{colors.frost-voice}'
    typography: '{typography.key-label}'
    rounded: '{rounded.base}'
    padding: '8px 14px'
    width: '246px'
    height: '42px'
  key-them-live:
    backgroundColor: '{colors.frost-field}'
    textColor: '{colors.on-voice}'
  input:
    backgroundColor: '{colors.carbon-sheet}'
    textColor: '{colors.bone}'
    rounded: '{rounded.base}'
    padding: '7px 10px'
    height: '36px'
  segmented-option:
    textColor: '{colors.bone-muted}'
    padding: '3px 10px'
    height: '28px'
  segmented-option-checked:
    backgroundColor: '{colors.bone}'
    textColor: '{colors.carbon-ground}'
  switch-track:
    backgroundColor: '{colors.control-edge}'
    rounded: '{rounded.s}'
    width: '36px'
    height: '20px'
  switch-track-on:
    backgroundColor: '{colors.accent}'
  badge:
    backgroundColor: '{colors.carbon-lifted}'
    textColor: '{colors.bone-muted}'
    rounded: '{rounded.s}'
    padding: '1px 7px'
  badge-ok:
    backgroundColor: '{colors.ok-soft}'
    textColor: '{colors.ok}'
  badge-warn:
    backgroundColor: '{colors.warn-soft}'
    textColor: '{colors.warn}'
  dialog:
    backgroundColor: '{colors.carbon-raised}'
    textColor: '{colors.bone}'
    rounded: '{rounded.l}'
    width: 'min(760px, calc(100vw - 24px))'
  card:
    padding: '18px 0 4px'
---

# Design System: Tarjuman

## Overview

**Creative North Star: "The Instrument in a Dark Room"**

Tarjuman is an instrument, not a page. A carbon ground under fine still grain carries bone-white linework and type, and the two voices of a call are drawn on it as light: ember for your own voice, warm like a lit filament, and frost for the other side, cold like daylight. Across the console lies one surface, a simulated sheet of water drawn as ridgelines at a low angle; each live voice drives its own end of it, and where the two waves meet in the middle the lines turn white. That meeting is the interpreting, and it is the one image the interface is built around.

Everything else serves reading during a live call. Structure is drawn with 1px hairlines as rules between things, the way a column is ruled, and the names of things are set in small, wide, spaced capitals like the lettering on a control desk. Captions are the largest text below the console and always the most legible. Motion is slow and exponential: things arrive out of the dark, fading in where they stand, nothing bounces, and with reduced motion everything is still. Dark is the design; "Daylight" is a light variant chosen in the settings, produced by the same tokens through `light-dark()`.

The system refuses both of its earlier selves: the neon "AI studio" of purple glows, gradient ribbons and glass, and the pale editorial page. The owner's words for this world were "dark and futuristic", "slow appearing animations, motion graphics, transitions and hover effects", "clean cool", and nothing that reads as a generated template.

**Key Characteristics:**

- One carbon ground, one bone ink, and two voices as light: ember (you) and frost (them).
- Hairline rules instead of boxes; corners of 2px and 3px; no pills.
- Wide, light Roboto Flex for the instrument's own words; Atkinson Hyperlegible Next for everything read at a glance.
- Your side on the left, theirs mirrored on the right, the measurements between them.
- Outlines that fill from their own side under the pointer; quiet actions that draw a line.
- Slow arrivals on an exponential ease-out; nothing overshoots; reduced motion means still.

## Colors

A near-black neutral scale, one bone ink in three strengths, and exactly two hues that mean something: the two voices. Every other colour reports a state. All values are defined once as `light-dark()` pairs (Daylight first, dark second); the page is dark unless `data-theme='light'` is set on the root.

### Primary

- **Ember** (`ember-voice`, `ember-field`): your own voice. It colours the left end of the wave surface, your key, your lamp and speaker name, the signal line over your translations, the active step of your pipeline, your level meter, and the focus edge of the typing box while "I say" is chosen. `ember-field` is the fill of a live key or a chosen option; in the dark both are the same value, in Daylight the field is slightly deeper so white text sits on it.

### Secondary

- **Frost** (`frost-voice`, `frost-field`): the other side's voice, used in exactly the same places on the mirrored side.
- **On Voice** (`on-voice`): the text on either field. Near-black in the dark (the voices are bright), white in Daylight.

### Tertiary

- **Ok** (`ok`, `ok-soft`), **Warn** (`warn`, `warn-soft`), **Danger** (`danger`, `danger-soft`): states only. The strong value is a dot, an icon or text; the soft value is the ground of a badge or banner.

### Neutral

- **Carbon Ground** (`carbon-ground`): the page, the masthead, the console and the typing bar.
- **Carbon Sheet** (`carbon-sheet`): the conversation and inputs.
- **Carbon Raised** (`carbon-raised`): dialogs, popovers, menus, slips on the console.
- **Carbon Lifted** (`carbon-lifted`): hover grounds, neutral badges, the unfilled part of a slider track.
- **Bone** (`bone`), **Bone Muted** (`bone-muted`), **Bone Faint** (`bone-faint`): ink in three strengths. Muted is secondary text and titles at rest; faint is metadata and labels at rest.
- **Hairline** (`hairline`) and **Strong Hairline** (`hairline-strong`): the rules of the grid, translucent so they sit on any ground. Strong marks the edges that matter: column heads, the typing bar, floating layers.
- **Control Edge** (`control-edge`): the outline of inputs, selects, buttons and the off switch.
- **Border** and **Border Strong** (`border`, `border-strong`): opaque edges, used for the scrollbar, the setup guide's stations and thread, `kbd`, and mixed into banner and error edges.
- **Accent** (`accent`, `accent-contrast`, `accent-soft`): links, focus and the on switch. It is the bone of the linework, not a hue.

### Named Rules

**The Two Voices Rule.** Ember is you and frost is them, everywhere the two appear, and they are always paired with a text label ("You speak", "Them"), never colour alone. No other element may borrow either hue.

**The Bone Accent Rule.** Links, focus rings, switches and the ordinary primary button are bone. Colour stays with the voices and the states.

**The Light Without Glow Rule.** A voice is a line, a letter or a flat fill. It never blurs, blooms or casts coloured light. The lamp's pulse is a 1px ring that leaves it, and the pipeline's light is a segment travelling along a 1px line.

**The Tested Contrast Scope.** `contrast.test.ts` reads the hex `light-dark()` tokens from `base.css` and checks, in both themes, exactly three things: `--text-faint` at 4.5:1 or better on `--bg`, `--surface` and `--surface-2`; `--control-border` at 3:1 or better on the same three; and `--ok`, `--warn`, `--danger` and `--accent` at 4.5:1 or better on their own `-soft` ground. The voices, `--text-muted`, `--surface-3`, `--on-channel`, the hairlines and dimmed states are not covered by it; a change to those needs its own check.

## Typography

**Display Font:** Roboto Flex Variable, standard axes (with Atkinson Hyperlegible Next Variable, system-ui)
**Body Font:** Atkinson Hyperlegible Next Variable (with system-ui, Segoe UI)
**Label/Mono Font:** Martian Mono Variable (with ui-monospace, Consolas)
**Urdu:** Noto Nastaliq Urdu Variable by default; Noto Naskh Arabic Variable when chosen in the settings

**Character:** The instrument speaks in Roboto Flex set wide and light, the extended, airy lettering of control rooms, and its width axis lets a title open or tighten as it moves. People are read in Atkinson Hyperlegible, whose easily confused letters are made distinct. All five faces are bundled; nothing is fetched at run time. The stylesheet sets width with `font-stretch`; the `fontVariation` values in the frontmatter are the same widths written as the `wdth` axis.

### Hierarchy

- **Display** (`display`): the two direction titles on the console ("Urdu → German"). Muted at rest, bone while the side is live, and while its voice speaks it gains weight and width (430, 134%) over 1.1s. Below a 679px console it drops to clamp(17px, 5.2vw, 24px); in a window under 640px high, to clamp(20px, 2.2vw, 30px).
- **Wordmark** (`wordmark`): "Tarjuman" on the empty page only, in capitals. It opens from a narrow, heavy block (width 25, weight 900) into its resting wide, light setting. The masthead name is the same lettering at 13px, weight 520, width 151%, tracking 0.34em.
- **Headline** (`headline`): the empty page's one heading.
- **Title** (`title`): dialog titles.
- **Section title** (`section-title`): headings inside a dialog (a settings section, a service, a step of the setup guide): the dialog title's lettering, a size down.
- **Caption** (`caption`): the translation of a sentence, the text the page exists for. Its original (`caption-source`) sits in muted bone; an extra caption language is 14.5px. All caption sizes multiply by `--caption-scale` from the Appearance settings.
- **Urdu caption** (`caption-urdu`): Nastaliq needs room: line-height 2.1 for the translation, 2.05 at 16px for the original. With Naskh chosen, line-height is 1.75. A Latin word inside Urdu takes the caption face at 0.8em and keeps its own left-to-right order.
- **Body** (`body`): interface text, 14px. Secondary notes are 12.5px to 13.5px; control text is weight 600 to 650.
- **Label** (`label`): the names of things in wide, spaced capitals. The shared setting is 10.5px, weight 560, width 135%, tracking 0.18em; observed instances run from 9px (pipeline steps) to 11.5px (the conversation's title), widths 132% to 140%, tracking 0.06em to 0.22em. Inside dialogs the names of controls (field labels, legends, the "advanced" summary) are the same lettering at 10px, line-height 1.4, tracking 0.16em, and tabs at 10.5px. The keys use `key-label`.
- **Measurement** (`measurement`, `measurement-small`): Martian Mono with tabular figures and a slashed zero.

### Named Rules

**The Measurement Rule.** Martian Mono is only for measurements and code: clock times, delays, counts, slider values, provider ids, `kbd`. It never sets a name, a label or a sentence.

**The Wide Capitals Rule.** A name of a thing (a speaker, a language, a pipeline step, a service, a measurement's title, a key, a control, a tab) is Roboto Flex in capitals, at 9px to 13px, width 132% or wider, with positive tracking. These are the labels of parts on an instrument; they are not kickers above headings.

**The Captions First Rule.** Anything read at a glance during a call is Atkinson Hyperlegible, and the translation is the heaviest and largest text in the conversation. Decoration never competes with it.

**The Nastaliq Room Rule.** Urdu gets its own line-height and its own face; anything pinned over scrolling Urdu fades the text out beneath it over a full caption line (34px to 40px) instead of slicing its deep strokes, and the masks a rising Urdu line travels behind are opened by 0.55em so no stroke is cut.

## Layout

The page is three bands in a full-height grid (100dvh): a masthead rule (min-height 56px), the console, and the conversation, which takes all remaining height and is the only part that scrolls. One left edge (`page-x`) is shared by the masthead, both console sides and the conversation.

The console is a two-column grid with a `console-gap` between the halves and four shared rows (titles, the surface, the controls, notes), so both sides line up across the middle. Your side hangs from the left; theirs is its exact mirror, hanging from the right, with row directions reversed. The two measurements float over the middle. The surface row deepens with the window: clamp(72px, calc(46vh - 250px), 240px).

The conversation is set like a bilingual edition when every column has room: a `gutter` for the speaker and time, then one column per language in the same place for every sentence, separated by `column-gap` with a hairline rule drawn down the middle of each gap, to a maximum width of 1600px. The language heads stay pinned at the top and the speaker's name stays pinned in the gutter for as long as any of the sentence is in view. When there is no room the languages stack in a single column of at most 800px and the speaker line pins instead. The list takes the full height even when it is one sentence long, so the column rules run to the bottom. While a call is being followed the conversation rests on whole sentences: the top edge falls between two of them, room is left under the newest so the page turns by whole sentences, and a line still waiting for its words never takes the page from the sentence being read. The typing bar is fixed to the bottom of the conversation; notices appear as a strip in the flow under the conversation's title and never cover a caption.

Responsive behaviour is driven by the container, not the device:

- Console narrower than 1120px: the measurements leave and the pipeline takes a full row.
- Console narrower than 680px: each side is a narrow column, the key says one word, and the pipeline names only the step at work.
- Viewport 1180px and below: healthy services show as dots alone. 860px and below: `page-x-compact`, masthead actions become icons, the console gap closes to 8px. 560px: the mark alone carries the brand. 480px: the connection is its dot alone.
- Window height 700px and below: the surface is not drawn and its row closes to 14px, so the height goes to the conversation. 640px and below: the direction titles and the sentence padding tighten. 520px and below: the page scrolls as a whole and the conversation keeps a height of max(340px, 88dvh).
- Typing bar 560px and narrower: the send button is its icon alone.

Words that leave the screen at narrow sizes remain for screen readers. Long words, URLs and German compounds wrap; nothing scrolls sideways.

### Named Rules

**The One Edge Rule.** The masthead, both units and the conversation start on the same left edge, 24px, or 14px at 860px and below.

**The Mirror Rule.** Whatever your side does from the left, their side does from the right: alignment, row direction, the pipeline's direction, the meter, and the side a key fills from.

**The Drawn, Never Boxed Rule.** The page's structure is ruled with 1px hairlines between bands, rows and columns. Outlines belong to controls and to layers that float (dialogs, popovers, menus); a section of the page is never put in a box. A line set across all columns breaks their rules; a rule must never strike through text.

## Elevation & Depth

The system is flat. Depth on the page is tonal (ground, sheet, raised, lifted) and ruled. Over the dark ground lies a fixed, still grain (a tile of fractal noise drawn once, opacity 0.085) that keeps large black areas from looking like a switched-off screen; Daylight has none. The wave surface makes its own depth by perspective: nearer ridgelines are brighter and hide the ones behind, and the surface dissolves at its horizon and near edge instead of ending in a cut.

### Shadow Vocabulary

- **Pop** (`box-shadow: 0 0 0 1px var(--hair-strong), 0 2px 6px rgb(0 0 0 / 0.3), 0 28px 60px -20px rgb(0 0 0 / 0.7)`): the only shadow. Dialogs, the services popover, menus and the "jump to newest" button. It is a hairline ring plus black falloff, never coloured.
- **Focus ring** (`box-shadow: 0 0 0 3px color-mix(in oklab, var(--text) 16%, transparent)`): the halo of a focused field; the typing box uses the chosen voice at 18%, the slider's cap the accent at 28%. Everything else focuses with a 1px bone outline offset by 3px.
- **Backdrop** (`rgb(0 0 0 / 0.62)`): behind a dialog, arriving over 0.5s and leaving in 0.24s.

### Named Rules

**The Flat Dark Rule.** Nothing on the page itself casts a shadow. A shadow means the thing floats above the page and will go away again.

## Shapes

Corners are nearly square: 2px for controls and small parts, 3px for floating layers, 1px for the caps inside controls (the switch's cap, the slider's cap, a segmented option, the send button). A sheet along the screen edge has none. Circles are reserved for points of state: the 6px service dot, the 8px lamp, the setup guide's numbered stations (a station that is done is a ring and a tick drawn in `ok`, with nothing filled in). The recurring mark is the nuqta, the rhombus dot of Arabic calligraphy: a 6px square turned 45 degrees, used for a speaker, for the option of a voice, and (at 5px, outlined until taken) for each step of the pipeline. Lines are 1px everywhere; the level meter is a 3px strip cut into cells 3px wide with 2px gaps.

## Components

Controls are outlines that answer the pointer by filling from their own side. They read as parts of a desk: mechanical, exact, quiet until touched.

### Buttons

- **Shape:** nearly square corners (2px), a 1px `control-edge` outline, min-height 34px, padding 6px 14px, weight 600.
- **Default:** an outline. Under the pointer a bone fill sweeps in from the left over 0.55s and the label takes the ground's colour as it passes.
- **Primary:** the inverse: already filled in bone, it opens into an outline under the pointer.
- **Danger:** outlined and lettered in `danger`; the sweep is `danger`.
- **Quiet:** only its words, in muted bone; a 1px line draws under them from the left and the words come up to full bone. Masthead actions are quiet, and their icon turns a quarter.
- **Small:** min-height 28px, padding 3px 10px, 13px.
- **Icon button:** 32px square, no edge; the ground lifts to `carbon-lifted` under the pointer. Icons are line icons (Lucide, inline SVG), never glyph characters.
- **Press and disabled:** a press scales to 0.97 (icon buttons 0.92) in 0.12s; disabled is opacity 0.4.

### The Keys

Each side has one key, its primary action, in the bottom corner of its half: 246px wide so nothing beside it moves between "start" and "stop", min-height 42px, outlined and lettered in the voice's colour in `key-label`. Under the pointer it fills with the voice's field from this side's own edge (left for you, right for them) over 0.7s. Live, it stays filled with `on-voice` lettering and its icon blinks; under the pointer it empties again, because the action it now offers is to stop. Beside it sits a 42px square with a strong hairline edge for devices and voice; its sliders icon flips under the pointer. The send button of the typing box is a small key (min 34px, 10.5px lettering) whose arrow moves 3px forward. Push-to-talk is a dashed outline in the voice's colour that turns solid and filled while held.

### Lamp, Pipeline, Meter, Measurements

- **Lamp:** an 8px ring. Off is empty in faint bone; live is lit in the voice's colour; while the voice speaks a 1px ring leaves it and fades (scale 1 to 3.4 over 1.6s); starting blinks; an error is `danger`.
- **Pipeline:** the four steps a sentence takes (hear, write, translate, speak) as rhombus marks on a line, labelled in 9px wide capitals. Steps taken are filled in muted bone; the step at work is in the voice's colour and a light runs along the line into it (1.5s, linear). On their side the line runs the other way.
- **Meter:** the exact level reading, in the voice's colour; faint bone while gated.
- **Measurements:** a wide-capital title in faint bone over a `measurement` figure. A figure that changes rolls up into place like a counter's wheel, rising from below behind the edge of its own box (1s).

### The Surface

The signature. A canvas behind the console holds a damped wave equation on a 132 by 30 grid, one field per voice and one for the pointer, drawn as 1px ridgelines at a low angle. Your level drives the left end and theirs the right; a wave carries its voice's colour, bone at rest, and the lines turn white where both voices are on the same water. A slow swell keeps it from ever lying flat; a moving pointer presses it down; when a sentence has been interpreted one crest crosses from its speaker's end to the other in under two seconds. It reads its colours from the tokens, so it follows the theme, and it appears from the middle distance outwards over 3.2s. With reduced motion it is one still frame with each live side tinting its end. It is a picture of the call, never a reading: the meters stay exact.

### Inputs / Fields

- **Style:** `carbon-sheet` ground, 1px `control-edge`, 2px corners, min-height 36px, padding 7px 10px. Labels are wide capitals in muted bone (10px, weight 560, width 135%, tracking 0.16em; a legend keeps 6px below it); notes are 12.5px in faint bone, or `warn` / `danger`.
- **Hover / Focus:** the edge goes to muted bone under the pointer; focused, the edge is bone with the 3px focus ring.
- **Typing box:** the same field with a caret in the chosen voice's colour and a focus edge and ring in that colour. Its placeholder stays on one line and fades out before the send button instead of wrapping.
- **Disabled:** opacity 0.55.
- **Slide switch:** a 36 by 20px slot with a 16px square, ridged cap that slides 16px over 0.5s. Off, the slot is `control-edge`; on, it is bone.
- **Fader slider:** a 2px track filled in bone up to the value, with a 10 by 20px cap outlined in bone with a centre line; its value is set in mono at 11px.
- **Segmented control:** options inside a 1px strong hairline, 2px inset, min-height 28px. The chosen option is filled in bone with ground-coloured text; in the typing bar the chosen voice is filled with its own field instead, and each option carries the voice's rhombus.
- **Tabs:** wide capitals at 10.5px in muted bone; the selected tab is bone, and a 1px bone rule draws under it from the left over 0.5s, over the hairline beneath the row.

### Conversation

- **Row:** a sentence between hairline rules, padding 18px above and 20px below (20px and 22px side by side). The speaker is a rhombus and a name in the voice's colour; the time and the delay are mono in faint bone, the delay in `warn` when slow.
- **Arrival:** during a call a sentence only fades in where it lands (0.7s); the rise of its translation is its one movement. The translation rises line by line behind masks (1.15s; Latin lines travel 105% of their height and Urdu lines 160%; the lines start at most 0.1s apart and the last within about a third of a second), and the other captions and the delay fade in beside it (0.9s after 0.15s), under a 1px signal line in the voice's colour that draws across once and fades (1.9s), from the right for Urdu. Speech still being recognised or translated is a 1px line up to 132px long with the pipeline's travelling light. Only when the page opens on a conversation already under way do its sentences come into focus (opacity, 6px blur, 14px rise over 1.1s), one after another, the newest first.
- **Reading focus:** under a moving pointer one sentence stays lit and the words of the others step back; pointing at a language's head does the same for its column. Who spoke, the time and the delay keep their full strength.
- **Empty page:** before anything is said, the conversation is set as the title page of its own grid. Side by side, the Latin wordmark and the headline stand in the first Latin column, the meaning of the name in the middle column and the name in Nastaliq in the Urdu column; the three numbered steps stand one per column, and the two closing lines form a foot row. Stacked, the two names share the first row and the copy runs the full width of the column. Its spacing follows the height of the window, so the whole page is there without scrolling on a laptop. It is drafted in: the column rules draw downwards (2.2s), the Nastaliq name, fitted to its ink, is drawn as a 1px outline (2.8s) and then inked from right to left (1.8s), the wordmark appears as a narrow heavy block and opens out (2.4s), and the copy rises line by line. When the first sentence arrives it fades and lifts 12px away in 0.3s, without blur, and the sentence waits those 0.3s so the two are never on the page at once.
- **Scrolling:** the wheel is smoothed (Lenis, lerp 0.13, clocked by GSAP); touch, keys and scrollbars keep the browser's own scrolling. A wheel that stops within 44px of the start of a sentence eases onto it over 0.6s; a stop further in is the reader's choice and stays. The glide that turns the page to a new sentence takes 0.9s.

### Navigation

The masthead is a rule across the top: the mark (the letter ت with its two dots, one per voice), the name in wide capitals, the language pair with a swap button whose arrows turn over, then the connection and the three services as dots with wide-capital names, and two quiet actions. The services are one button with no box at rest; its edge appears under the pointer and it unfolds a popover downwards (clip-path, 0.7s).

### Dialogs, Sheets, Notices

- **Dialog:** `carbon-raised`, a strong hairline edge, 3px corners, the pop shadow, at most 760px wide. It hangs from a fixed height (`clamp(12px, 8vh, 88px)` from the top) instead of being centred, so a message strip opening or closing inside it changes its height downwards and nothing above moves. It rises 22px out of the dark from scale 0.985 (opacity 0.45s, movement 0.6s) and its content fades in over 0.5s, 0.08s later. It goes back quicker than it came: 0.24s, ease-in, fading and sinking 10px, with its backdrop; the content stays for those 240ms. The close cross turns a quarter under the pointer.
- **Sheet:** the same dialog along the right edge, at most 440px wide, full height, square, arriving from 56px to the right and leaving 24px that way.
- **Service rows:** in the settings, one service among several is set off by a strong hairline above it (padding 18px 0 4px) under a `section-title`; it has no box, fill or corners of its own.
- **Badges:** small squared tags (11.5px, weight 650) on `carbon-lifted`, or a state's soft ground with its strong colour.
- **Notices:** on the page, a full-width strip of one-line messages divided by hairlines, with an icon in the state's colour. Banners for missing keys or a lost connection are full-width bands on the state's soft ground.

### Named Rules

**The Own Side Rule.** A fill enters from the side the control belongs to: buttons from the left, your key from the left, their key from the right. A filled control empties under the pointer when its action is to undo itself.

**The Slow Arrival Rule.** Things arrive on `cubic-bezier(0.16, 1, 0.3, 1)`: quick to answer, long to settle, never overshooting. Arrivals on the page take 0.6s to 2.2s (small changes inside dialogs and notices, such as a tab panel, a banner or a toast, take 0.24s to 0.36s); the page's own opening runs about three seconds, but the keys are there first and at once, because starting a channel must never wait. Things fade in where they stand: the one movement of the opening is the two direction titles coming into focus (30px, 10px blur, 2.2s), and blur exists only there and on the sentences already present when the page opens. Leaving is quicker than arriving (a dialog 0.24s, the empty page 0.3s). Presses answer in 0.12s. Motion only ever shows what the state already says; it never delays audio, the network or the transcript.

**The Step Back Rule.** Hover focus in the conversation dims the words of the other rows or columns (the caption cells) to opacity 0.78 over 0.6s, no further; the speaker, the time and the delay are not dimmed, and a language tag inside a caption goes to muted bone. It applies only while the pointer is in use (the component clears the state 2.6s after the pointer rests, and it applies only where hover exists). A pointer parked on the conversation never dims a call.

**The Still Rule.** With `prefers-reduced-motion`, transitions and animations collapse to nothing, GSAP timelines and smooth scrolling do not start, and the surface is a single frame.

## Do's and Don'ts

### Do:

- **Do** keep ember for your voice and frost for theirs in every new element that belongs to a side, with a text label beside the colour.
- **Do** draw structure with 1px `hairline` / `hairline-strong` rules and keep corners at 2px (3px for floating layers).
- **Do** set names of things in Roboto Flex wide capitals (width 132% or more, positive tracking, 9px to 13px) and titles wide and light (weight 280 to 330).
- **Do** set every number that is measured (a time, a delay, a count, a slider value) and every identifier in Martian Mono with tabular figures.
- **Do** mirror anything added to one side of the console on the other.
- **Do** let outlined controls fill from their own side over 0.55s to 0.7s on `--ease-out`, and let quiet actions draw a 1px line.
- **Do** define any new colour once as a `light-dark()` pair and check it in both themes; extend `contrast.test.ts` when the pair carries text or a control edge.
- **Do** give every new motion a reduced-motion answer, and keep it off the capture path and independent of timers.
- **Do** bundle every asset; nothing is fetched at run time.

### Don't:

- **Don't** bring back the neon "AI studio": purple glows, gradient ribbons, glass or backdrop blur. The owner asked for nothing that reads as generated effects.
- **Don't** bring back the pale editorial page as the default; the owner rejected it, and light exists only as the Daylight variant of these same tokens.
- **Don't** make a voice glow, bloom or blur. Gradients here are tools (a sweep fill, a travelling light on a line, a fade under a pinned head, the stroke of the surface), never decoration.
- **Don't** use pills or large radii; the only round things are points of state.
- **Don't** box a section of the page; outlines are for controls and floating layers.
- **Don't** use ember or frost for anything that is not one of the two voices, and don't use a state colour for decoration.
- **Don't** set names, labels or sentences in Martian Mono.
- **Don't** add bounce, overshoot or elastic easing, and don't make the keys wait for an entrance.
- **Don't** dim unfocused captions below opacity 0.78, and don't dim at all without a moving pointer.
- **Don't** let a notice, a popover or an animation cover or delay a caption.
