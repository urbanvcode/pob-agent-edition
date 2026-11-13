/** Text helpers for the knowledge engine: HTML to text, key words, passage ranking. */

const STOP = new Set(("a an and are as at be by can do does for from has have how i in is it its my of on or that the their this to was what when where which who why will with you your " +
  "poe poe1 poe2 path exile work works mean means much many get gets explain about into than then there per vs versus").split(" "));

/** Lower-case key words with plural endings trimmed ("resistances" -> "resistance"). */
export function keyWords(text: string): string[] {
  const words = text.toLowerCase().replace(/['’]s\b/g, "").match(/[a-z0-9][a-z0-9'%.-]*[a-z0-9%]|[a-z0-9]/g) ?? [];
  const out: string[] = [];
  for (const word of words) {
    if (STOP.has(word)) continue;
    const stem = stemWord(word);
    if (!out.includes(stem)) out.push(stem);
  }
  return out;
}

/** A light stem so "capped", "caps" and "cap", or "increase" and "increased", count as the same word. */
export function stemWord(word: string): string {
  if (/^\d/.test(word) || word.length < 4) return word;
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  const undouble = (s: string) => (/([b-df-hj-np-tv-z])\1$/.test(s) && !/(ll|ss)$/.test(s) ? s.slice(0, -1) : s);
  if (w.length > 5 && w.endsWith("ing")) w = undouble(w.slice(0, -3));
  else if (w.length > 4 && w.endsWith("ed")) w = undouble(w.slice(0, -2));
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "—", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "..." };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Tags out, entities decoded, white space collapsed. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export interface Passage { heading: string; text: string }

/** MediaWiki plain-text extract ("== Heading ==" lines) -> paragraphs with their heading. */
export function passagesOf(extract: string): Passage[] {
  const out: Passage[] = [];
  let heading = "";
  for (const raw of extract.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^(=+)\s*(.+?)\s*=+$/.exec(line);
    if (h) { heading = h[2]; continue; }
    out.push({ heading, text: line });
  }
  return out;
}

/** How well a text answers the key words: share of key words present, with a bonus for words in the heading. */
export function scoreText(words: string[], text: string, heading = ""): number {
  if (!words.length) return 0;
  const have = new Set(keyWords(text));
  const inHeading = new Set(keyWords(heading));
  let score = 0;
  for (const word of words) score += have.has(word) ? 1 : inHeading.has(word) ? 0.5 : 0;
  return score / words.length;
}

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "")) + " [...]";
}

/** Sentences of a passage (kept simple: wiki prose and patch-note lines). */
export function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(+])/).map((s) => s.trim()).filter(Boolean);
}

/** Numbers in a text as written: "75%", "+30", "1.5". Version-like and list numbers are kept as plain numbers. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ""));
}
