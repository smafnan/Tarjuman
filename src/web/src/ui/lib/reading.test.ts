import { describe, expect, it } from 'vitest';

import { restingPlace, settleOffset, type Sentence } from './reading';

/** Sentences one under another from `top`, with the given heights; 'u' marks one still unwritten. */
function stack(heights: readonly (number | `${number}u`)[], top = 6): Sentence[] {
  let at = top;
  return heights.map((entry) => {
    const height = typeof entry === 'number' ? entry : Number.parseInt(entry, 10);
    const sentence = { top: at, height, unwritten: typeof entry !== 'number' };
    at += height;
    return sentence;
  });
}

const view = { height: 400, inset: 0, air: 28 };

describe('restingPlace', () => {
  it('stays at the top while everything fits', () => {
    expect(restingPlace(stack([120, 140]), view)).toEqual({ at: 0, room: 0 });
    expect(restingPlace([], view)).toEqual({ at: 0, room: 0 });
  });

  it('gives up the air under the last sentence before it lets go of one at the top', () => {
    // 6 + 180 + 190 = 376: with the full 28px of air this would scroll 4px into the first.
    expect(restingPlace(stack([180, 190]), view)).toEqual({ at: 0, room: 0 });
  });

  it('turns the page to the start of a sentence and leaves room to scroll that far', () => {
    // The end falls at 476 + 28 - 400 = 104, inside the first sentence: the second starts the page.
    expect(restingPlace(stack([180, 190, 100]), view)).toEqual({ at: 187, room: 83 });
  });

  it('keeps the same page when the next sentence fits in the room left', () => {
    const before = restingPlace(stack([180, 190, 100]), view);
    const after = restingPlace(stack([180, 190, 100, 70]), view);
    expect(after.at).toBe(before.at);
    expect(after.room).toBe(before.room - 70);
  });

  it('measures the start of a sentence from under the column heads', () => {
    const rest = restingPlace(stack([180, 190, 100], 46), { ...view, inset: 40 });
    // 46 + 180 = 226 is where the second begins; the heads cover the first 40px of the view.
    expect(rest.at).toBe(226 - 40 + 1);
  });

  it('shows the end as it falls rather than a mostly empty page', () => {
    // Turning to the last sentence would leave 273px of 400 empty.
    expect(restingPlace(stack([380, 100]), view)).toEqual({ at: 486 + 28 - 400, room: 0 });
  });

  it('does not let a line without words take the page from the sentence being read', () => {
    // Only the unwritten one would fit whole; the written one stays, from its start.
    expect(restingPlace(stack([300, '80u']), { ...view, height: 320 })).toEqual({ at: 0, room: 0 });
  });

  it('turns the page for a line without words when the sentence being read stays on it', () => {
    // The words that are coming then land on a page that is already still.
    expect(restingPlace(stack([200, 150, '80u']), view)).toEqual({ at: 207, room: 143 });
  });

  it('rests on the written sentences when turning for a waiting line would empty the page', () => {
    // Turning to the short sentence and the waiting line would leave 233px of 400 empty.
    expect(restingPlace(stack([300, 60, '80u']), view)).toEqual({ at: 0, room: 0 });
  });

  it('shows a sentence a little taller than the page from its start', () => {
    expect(restingPlace(stack([330]), { ...view, height: 320 })).toEqual({ at: 7, room: 0 });
  });

  it('shows a much taller sentence from its end', () => {
    expect(restingPlace(stack([520]), view)).toEqual({ at: 526 + 28 - 400, room: 0 });
  });

  it('ends a taller written sentence at the bottom edge while another waits below', () => {
    // Its closing rule (the last pixel of 526) sits just under the edge.
    expect(restingPlace(stack([520, '80u']), view)).toEqual({ at: 526 - 1 - 400, room: 0 });
  });

  it('follows lines without words when nothing has been written yet', () => {
    expect(restingPlace(stack(['80u', '80u']), { ...view, height: 150 })).toEqual({ at: 87, room: 43 });
  });
});

describe('settleOffset', () => {
  const sentences = stack([140, 130, 140, 126]);

  it('eases onto the start of a sentence within reach, from either side', () => {
    // The second starts at 146 (+1).
    expect(settleOffset(sentences, 120, 0, 44)).toBe(27);
    expect(settleOffset(sentences, 170, 0, 44)).toBe(-23);
  });

  it('leaves the view in the middle of a sentence', () => {
    expect(settleOffset(sentences, 210, 0, 44)).toBe(0);
  });

  it('leaves a view that already rests on a start', () => {
    expect(settleOffset(sentences, 147, 0, 44)).toBe(0);
  });

  it('measures from under the column heads', () => {
    expect(settleOffset(stack([140, 130], 46), 130, 40, 44)).toBe(46 + 140 - 40 + 1 - 130);
  });
});
