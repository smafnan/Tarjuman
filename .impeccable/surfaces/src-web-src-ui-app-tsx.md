---
version: 1
slug: "src-web-src-ui-app-tsx"
primary_target: "src/web/src/ui/App.tsx"
related_targets: ["src/web/index.html"]
---

# Surface brief: the interpreter dashboard

Scope: the single page of the web app (`src/web/index.html`, rendered by `src/web/src/ui/App.tsx`), with
its dialogs and sheet. Visitor mode: Operate (the visitor completes a task during a live call), with an
owner who asked for full visual ambition on it.

Audience and job: an Urdu speaker in a German Teams call; start both sides, keep track of which voice
is open and where its sentence is, read every sentence in its language as it lands, fix routing
problems when told. Constraints: captions stay hyper-legible; nothing may slow the audio path; reduced
motion honoured; a Daylight variant exists but dark is the design; widths from 390 px to wide screens,
windows as low as 600 px.

Chosen direction (2026-11-26, second round): the owner rejected a light Swiss "edition" and asked for
dark and futuristic. Memorable moment: the surface across the console, where the two voices travel as
waves and meet in the middle.

Unresolved: none.

## Direction contract

THESIS: Tarjuman is an instrument in a dark room: two voices drawn as waves on one surface, meeting in
the middle, where interpreting happens. It refuses both of its earlier selves: the neon "AI studio"
(purple glows, gradient ribbons, glass) and the pale editorial page.

OWN-WORLD: Carbon ground (#08090a, sheet #0b0c0e) under fine still grain; bone linework and type
(#e9e6df); 1px hairlines at 9% and 18% white, drawn as column rules, never boxes; two voices as light
without glow, ember #ff6a3d for you and frost #9fc4ff for them; corners of 2 px; no decorative
gradients, glass, blurred glow or pills. Lettering: Roboto Flex set wide and light (titles at weight
280 and 128% width; names of things in small, wide, spaced capitals), Atkinson Hyperlegible Next for
captions, Martian Mono only for measurements, Noto Nastaliq for Urdu.

STORY: The visitor sees which voice is open and where its current sentence is (heard, written,
translated, spoken), starts each side with its one key, and reads each sentence in its language column
as it lands; before anything is said, the page explains the name and the three steps to begin.

FIRST VIEWPORT: A masthead rule: the mark, TARJUMAN in spaced capitals, the Urdu ⇄ German swap,
connection and service dots, setup guide, settings. Below it the console: "Urdu → German" top left and
"German → Urdu" mirrored top right in wide light type, each over its lamp, name and status; between
them two measurements (last delay, sentences); across the middle the wave surface, ember at its left
edge shading through bone to frost at its right; under it each side's key (the primary action, in the
bottom corners) with its devices button, pipeline and level meter. Then the conversation: title bar,
language column heads over hairline rules, sentences with a mono time gutter, and the typing box pinned
at the bottom.

FORM: the owner's pinned direction applied to an Operate surface, so layout, navigation and controls
stay standard. seed: none (pinned): "i want it dark and futuristic slow appearing animations, motion
graphics, transitions and hover effects", "clean cool", "NOT AI GENERATED WEBSITE EFFECTS", on "this
tarjuman dashboard". Signature move: the surface, a damped wave equation on a grid drawn as ridgelines
seen at a low angle; each live voice drives its own end, the waves meet in the middle, the pointer
disturbs it, and a slow swell keeps it from ever lying flat. Motion grammar: everything arrives slowly
on an exponential ease-out and nothing overshoots. The page's arrival: titles come into focus over two
seconds, the surface ignites from the middle, the conversation follows and its sentences arrive one
after another. A sentence comes into focus; its translation rises line by line behind masks under a
signal line in the voice's colour. The pipeline's light runs into the step at work. Hover: outlined
keys and buttons fill from their own side, quiet actions draw a line, and one sentence or one language
column stays lit while the others step back. Dialogs rise out of the dark. With reduced motion
everything is still.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
