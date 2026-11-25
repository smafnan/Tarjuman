/**
 * How far (in px, positive = right) a box spanning `left`..`right` must move to lie inside
 * a viewport of `viewportWidth`, keeping `margin` clear. A box wider than the viewport is
 * aligned to the left edge.
 */
export function shiftIntoViewport(
  left: number,
  right: number,
  viewportWidth: number,
  margin: number,
): number {
  if (right - left > viewportWidth - 2 * margin) return margin - left;
  if (left < margin) return margin - left;
  if (right > viewportWidth - margin) return viewportWidth - margin - right;
  return 0;
}
