/**
 * Runs of Latin letters inside Arabic-script text: a product name or a borrowed term such as
 * "payment module" in an Urdu sentence. The Nastaliq face would set them in its own serif
 * Latin; set apart, they can take the caption face and keep their left-to-right order.
 */
const LATIN_RUN = /[A-Za-z][A-Za-z0-9+#.'’&/-]*(?:\s+[A-Za-z][A-Za-z0-9+#.'’&/-]*)*/g;

export interface ScriptRun {
  text: string;
  latin: boolean;
}

export function splitLatinRuns(text: string): ScriptRun[] {
  const runs: ScriptRun[] = [];
  let from = 0;
  for (const match of text.matchAll(LATIN_RUN)) {
    const at = match.index;
    if (at > from) runs.push({ text: text.slice(from, at), latin: false });
    runs.push({ text: match[0], latin: true });
    from = at + match[0].length;
  }
  if (from < text.length) runs.push({ text: text.slice(from), latin: false });
  return runs;
}
