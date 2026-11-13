/**
 * poedb.tw (Path of Exile 1 section, /us/): datamined item text and each
 * page's "Version history" table.
 *
 * poedb has no API, so the HTML is parsed. The parser is strict about what it
 * recognises and has fixture tests, so a layout change shows up as a failing
 * test or a clear "not recognised" message instead of silently wrong facts.
 * One page per lookup, cached for a day.
 */
import { TTL, type PoliteFetcher } from "../fetcher.js";
import { decodeEntities, stripTags } from "../text.js";

export interface PoedbHistory { version: string; text: string }

export interface PoedbEntity {
  title: string;
  url: string;
  /** The item box as text lines (name, base, properties, requirements, mods). Empty when the page has no item box. */
  itemLines: string[];
  /** Mod lines only (implicit and explicit), for comparing with other sources. */
  modLines: string[];
  history: PoedbHistory[];
  retrieved_at: string;
  stale?: boolean;
}

/** "Hyrri's Ire" -> "Hyrris_Ire" (poedb's page naming). */
export function poedbSlug(name: string): string {
  return name.trim().replace(/['’]/g, "").replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "");
}

function innerOfDiv(html: string, from: number): string {
  // Balanced <div> scan starting at the opening tag at `from`.
  const re = /<(\/?)div\b[^>]*>/gi;
  re.lastIndex = from;
  let depth = 0, m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index);
  }
  return html.slice(from, from + 20_000);
}

export function parsePoedb(html: string): Pick<PoedbEntity, "title" | "itemLines" | "modLines" | "history"> {
  const title = decodeEntities(/<title>([^<]*)/i.exec(html)?.[1] ?? "").replace(/\s+-\s+PoEDB.*$/i, "").trim();
  const itemLines: string[] = [], modLines: string[] = [];
  const popup = html.search(/<div[^>]*class="newItemPopup\b/);
  if (popup >= 0) {
    const box = innerOfDiv(html, popup);
    const re = /<(div|span)[^>]*class="(lc|property|requirements|implicitMod|explicitMod|enchantMod|fracturedMod)\b[^"]*"[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(box))) {
      // A mod's value sits in nested spans, so read up to the tag that closes the outer element.
      const text = stripTags(closingAware(box, m.index, m[1])).replace(/\s*—\s*/g, "-");
      if (!text) continue;
      itemLines.push(text);
      // Lines wholly in brackets are reminder text, not mods.
      if (/Mod$/.test(m[2]) && !/^\(.*\)$/.test(text)) modLines.push(text);
    }
  }
  const history: PoedbHistory[] = [];
  const header = html.search(/<h5[^>]*class="card-header"[^>]*>\s*Version history/i);
  if (header >= 0) {
    const end = html.indexOf("</table>", header);
    const table = html.slice(header, end > 0 ? end : header + 60_000);
    const row = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;
    let m: RegExpExecArray | null;
    while ((m = row.exec(table))) {
      const version = stripTags(m[1]);
      if (!/^\d+\.\d+/.test(version)) continue;
      for (const item of m[2].split(/<li[^>]*>/i)) {
        const text = stripTags(item);
        if (text) history.push({ version, text });
      }
    }
  }
  return { title, itemLines, modLines, history };
}

/** Inner HTML of the element opening at `from`, honouring nested elements of the same tag. */
function closingAware(html: string, from: number, tag: string): string {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 0, start = -1, m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (!m[1]) { depth++; if (start < 0) start = re.lastIndex; }
    else if (--depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start < 0 ? from : start, from + 2000);
}

export class Poedb {
  constructor(private readonly fetcher: PoliteFetcher) {}

  /** The page for an item, gem or passive by its exact name, or null when poedb has no such page or nothing we recognise on it. */
  async entity(name: string, tag?: string, refresh = false): Promise<PoedbEntity | null> {
    const slug = poedbSlug(name);
    if (!slug) return null;
    const url = `https://poedb.tw/us/${slug}`;
    const page = await this.fetcher.get(url, { ttlMs: TTL.day, tag, refresh, allow404: true });
    if (!page) return null;
    const parsed = parsePoedb(page.body);
    if (!parsed.itemLines.length && !parsed.history.length) return null;
    return { ...parsed, url, retrieved_at: page.retrieved_at, ...(page.stale ? { stale: true } : {}) };
  }
}
