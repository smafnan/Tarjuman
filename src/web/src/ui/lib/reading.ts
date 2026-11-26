/**
 * Where the conversation comes to rest: on whole sentences.
 *
 * Followed during a call, the page holds whole sentences and turns by whole sentences. The
 * top edge falls exactly between two of them, and a sentence that fits in the room left under
 * the last one simply appears there, nothing moving. Pure geometry, so it can be tested
 * without a browser; the component measures and scrolls.
 */

/** One sentence of the conversation as it is laid out. */
export interface Sentence {
  /** Its top edge, from the top of the scrolled content. */
  top: number;
  height: number;
  /** Still waiting for its words: there is nothing to read on it yet. */
  unwritten: boolean;
}

export interface ReadingView {
  /** Height of the scrolling view. */
  height: number;
  /** How much of its top the column heads cover. */
  inset: number;
  /** The space under the last sentence when the conversation is scrolled to its very end. */
  air: number;
}

export interface Rest {
  /** The scroll position at which the view rests. */
  at: number;
  /** Room to leave under the last sentence, so that the view can scroll as far as `at`. */
  room: number;
}

/**
 * The most room left under the newest sentence so that the top edge falls between two
 * sentences, as a share of the height. Beyond it the page would look empty, and the end of
 * the sentence before is worth more than a clean edge.
 */
const ROOM_SHARE = 0.45;
/**
 * The least air kept between the newest sentence and the bottom edge. A page ends with more
 * than this, and gives the difference up before it lets go of a sentence at the top.
 */
const MIN_AIR_PX = 4;
/**
 * How far a single sentence that is taller than the page may run into its own closing space
 * (the 20px under its last line in layout.css) and still be shown from its start.
 */
const SNUG_PX = 12;

/** Where a sentence starts: a pixel into it, so that the rule under the one before is out of sight. */
function startOf(sentence: Sentence, inset: number): number {
  return sentence.top - inset + 1;
}

/**
 * Where the view rests while the reader follows the conversation.
 *
 * In order of preference:
 * 1. the whole sentences that end the conversation, as many as fit;
 * 2. without the ones still waiting for their words, when they would take the page from the
 *    sentence being read or leave it mostly empty;
 * 3. a sentence a little taller than the page from its start, close to the bottom edge;
 * 4. the end as it falls: of a sentence taller still, or when turning the page would leave
 *    more of it empty than `ROOM_SHARE`.
 */
export function restingPlace(sentences: readonly Sentence[], view: ReadingView): Rest {
  const { height, inset, air } = view;

  /** How far the view scrolls to show the first `count` sentences with `under` below them. */
  const endOf = (count: number, under: number): number => {
    const last = count > 0 ? sentences[count - 1] : undefined;
    return last ? last.top + last.height + under - height : 0;
  };

  /** The whole sentences ending the first `count`, or null when the last is taller than the page. */
  const pageOf = (count: number): (Rest & { from: number }) | null => {
    const tight = endOf(count, MIN_AIR_PX);
    if (tight <= 0) return { from: 0, at: 0, room: 0 };
    for (const [from, sentence] of sentences.slice(0, count).entries()) {
      const at = startOf(sentence, inset);
      if (at >= tight) return { from, at, room: Math.max(0, at - endOf(count, air)) };
    }
    return null;
  };
  const roomy = (page: Rest): boolean => page.room > height * ROOM_SHARE;

  let written = sentences.length;
  while (written > 0 && sentences[written - 1]?.unwritten) written -= 1;

  const whole = pageOf(sentences.length);
  // A page of nothing but lines waiting for their words would put the sentence being read out
  // of sight.
  if (whole && !roomy(whole) && (written === 0 || whole.from < written)) {
    return { at: whole.at, room: whole.room };
  }

  const waiting = written > 0 && written < sentences.length;
  const count = waiting ? written : sentences.length;
  const page = waiting ? pageOf(count) : whole;
  // With others waiting below there is nothing to leave room under: the view rests short of
  // the end.
  if (waiting && page && !roomy(page)) return { at: page.at, room: 0 };

  const newest = count > 0 ? sentences[count - 1] : undefined;
  if (!page && newest && startOf(newest, inset) >= endOf(count, -SNUG_PX)) {
    return { at: startOf(newest, inset), room: 0 };
  }
  // With others waiting below, the written sentences end at the bottom edge, their closing
  // rule just under it.
  return { at: Math.max(0, endOf(count, waiting ? -1 : air)), room: 0 };
}

/**
 * How far to ease a view that has coasted to a stop, so that it rests on the start of a
 * sentence; 0 to leave it where it is.
 *
 * Within `reach` of a start, the top edge cuts the last line of the sentence before or the
 * first line of this one. A stop further in is the reader choosing the middle of a long
 * sentence, and stays.
 */
export function settleOffset(
  sentences: readonly Sentence[],
  scrollTop: number,
  inset: number,
  reach: number,
): number {
  let nearest = Infinity;
  for (const sentence of sentences) {
    const offset = startOf(sentence, inset) - scrollTop;
    if (Math.abs(offset) < Math.abs(nearest)) nearest = offset;
    if (offset > reach) break;
  }
  return Math.abs(nearest) < 1 || Math.abs(nearest) > reach ? 0 : nearest;
}
