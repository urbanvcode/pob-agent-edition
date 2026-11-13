/**
 * Glossary: Path of Exile 1 terms for a player who knows Path of Exile 2.
 *
 * Every entry is a short summary in our own words plus a short exact quote
 * from the wiki page it rests on, and (where it helps) the same for the Path of
 * Exile 2 side. `checked` and `version` say when and for which game version the
 * quotes were confirmed; `npm run test:kb` re-checks every quote against the
 * live pages, so an entry that the wiki has moved on from fails the check
 * instead of going stale quietly.
 *
 * The data is in glossary-data.ts.
 */
import { GLOSSARY } from "./glossary-data.js";
import { keyWords } from "./text.js";

export interface GlossarySide {
  /** Summary in our own words. */
  text: string;
  /** Short exact quote from the page that backs the summary. */
  quote: string;
  /** Wiki page title. */
  page: string;
}

export interface GlossaryEntry extends GlossarySide {
  term: string;
  aliases?: string[];
  /** ISO date the quotes were confirmed against the pages. */
  checked: string;
  /** Game version that was live when the entry was checked. */
  version: string;
  poe2?: GlossarySide & { version: string };
}

export function wikiUrl(page: string, poe2 = false): string {
  return `https://www.${poe2 ? "poe2wiki" : "poewiki"}.net/wiki/${encodeURIComponent(page.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":").replace(/%27/g, "'").replace(/%2C/g, ",").replace(/%28/g, "(").replace(/%29/g, ")")}`;
}

const norm = (text: string) => keyWords(text).join(" ");

/**
 * The entry whose term or alias is the question ("what is spell suppression?").
 * A name inside a longer question only counts when it has two or more words and
 * makes up at least half of the question: "chaos" must not answer "Chaos
 * Inoculation", which is a different thing with its own page.
 */
export function findGlossary(query: string, entries: GlossaryEntry[] = GLOSSARY): GlossaryEntry | undefined {
  const q = ` ${norm(query)} `;
  const questionWords = q.trim().split(" ").length;
  let best: { entry: GlossaryEntry; length: number } | undefined;
  for (const entry of entries) {
    for (const name of [entry.term, ...(entry.aliases ?? [])]) {
      const n = norm(name);
      if (!n) continue;
      const exact = q.trim() === n;
      const words = n.split(" ").length;
      if (!exact && !(words >= 2 && words * 2 >= questionWords && q.includes(` ${n} `))) continue;
      const length = n.length + (exact ? 1000 : 0);
      if (!best || length > best.length) best = { entry, length };
    }
  }
  return best?.entry;
}

export function glossaryTerms(entries: GlossaryEntry[] = GLOSSARY): string[] {
  return entries.map((e) => e.term);
}
