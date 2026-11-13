/**
 * poewiki.net (Path of Exile 1) and poe2wiki.net (Path of Exile 2) through the
 * MediaWiki API: page text with the time of its last edit, search, and the
 * Cargo "versions" table (game versions with release dates).
 *
 * The wikis are community-written (CC BY-NC-SA 3.0): we keep short passages with
 * a link back, never whole articles, and rank them below every other source.
 * The request parameters are chosen so that no URL matches a Disallow rule of
 * the wikis' robots.txt (no "limit=", "search=", "section=" or "redirect=").
 */
import { TTL, type PoliteFetcher } from "../fetcher.js";
import { keyWords } from "../text.js";
import { KbError, type Game, type GameVersion, type SourceId } from "../types.js";

export interface WikiPage {
  title: string;
  url: string;
  /** Plain text: the intro only, or the whole page when `full`. */
  extract: string;
  full: boolean;
  /** ISO date-time of the page's last edit. */
  edited_at?: string;
  retrieved_at: string;
  stale?: boolean;
  /** The asked-for titles that resolved to this page (intros only). */
  asked?: string[];
}

export interface WikiSite { source: SourceId; game: Game; api: string }

export const POEWIKI: WikiSite = { source: "poewiki", game: "poe1", api: "https://www.poewiki.net/w/api.php" };
export const POE2WIKI: WikiSite = { source: "poe2wiki", game: "poe2", api: "https://www.poe2wiki.net/w/api.php" };

const PAGE_PROPS = "prop=extracts%7Crevisions%7Cinfo&explaintext=1&rvprop=timestamp&inprop=url&format=json&formatversion=2";

interface ApiPage { title?: string; missing?: boolean; invalid?: boolean; extract?: string; revisions?: Array<{ timestamp?: string }>; canonicalurl?: string; fullurl?: string; index?: number }

function parseApi(body: string, what: string): any {
  try { return JSON.parse(body); } catch { throw new KbError(`The wiki's answer for ${what} was not JSON (the site may have changed or be showing an error page).`); }
}

function toPage(p: ApiPage, full: boolean, retrieved_at: string, stale?: boolean): WikiPage | null {
  const url = p.canonicalurl ?? p.fullurl;
  if (!p.title || p.missing || p.invalid || !url || typeof p.extract !== "string" || !p.extract.trim()) return null;
  return { title: p.title, url, extract: p.extract, full, edited_at: p.revisions?.[0]?.timestamp, retrieved_at, ...(stale ? { stale } : {}) };
}

/** Wiki titles cannot hold these characters. */
function cleanTitle(title: string): string {
  return title.replace(/[#<>\[\]{}|]/g, " ").replace(/\s+/g, " ").trim();
}

export class Wiki {
  constructor(private readonly fetcher: PoliteFetcher, readonly site: WikiSite = POEWIKI) {}

  /** Intro text of several pages by exact title (redirects followed). Missing titles are left out. */
  async intros(titles: string[], tag?: string): Promise<WikiPage[]> {
    const wanted = [...new Set(titles.map(cleanTitle).filter(Boolean))].slice(0, 8);
    if (!wanted.length) return [];
    const url = `${this.site.api}?action=query&${PAGE_PROPS}&exintro=1&exlimit=${wanted.length}&redirects=1&titles=${encodeURIComponent(wanted.join("|"))}`;
    const page = await this.fetcher.get(url, { ttlMs: TTL.day, tag });
    const query = parseApi(page!.body, "page intros").query ?? {};
    // Which asked-for titles led to which page (the API normalises titles and follows redirects).
    const hops: Array<{ from: string; to: string }> = [...(query.normalized ?? []), ...(query.redirects ?? [])];
    const finalOf = (title: string): string => { let t = title; for (let i = 0; i < 4; i++) { const hop = hops.find((h) => h.from === t); if (!hop) break; t = hop.to; } return t; };
    const out: WikiPage[] = [];
    for (const p of (query.pages ?? []) as ApiPage[]) {
      const made = toPage(p, false, page!.retrieved_at, page!.stale);
      if (made) out.push({ ...made, asked: wanted.filter((w) => finalOf(w) === made.title) });
    }
    return out;
  }

  /** The whole page as plain text, or null when there is no such page. */
  async page(title: string, tag?: string, refresh = false): Promise<WikiPage | null> {
    const clean = cleanTitle(title);
    if (!clean) return null;
    const url = `${this.site.api}?action=query&${PAGE_PROPS}&redirects=1&titles=${encodeURIComponent(clean)}`;
    const page = await this.fetcher.get(url, { ttlMs: TTL.day, tag, refresh });
    const pages: ApiPage[] = parseApi(page!.body, `page "${clean}"`).query?.pages ?? [];
    return pages.length ? toPage(pages[0], true, page!.retrieved_at, page!.stale) : null;
  }

  /** Full-text search: the best pages with their intro, in the wiki's ranking order. */
  async search(query: string, tag?: string): Promise<WikiPage[]> {
    const words = cleanTitle(query);
    if (!words) return [];
    const url = `${this.site.api}?action=query&generator=search&gsrsearch=${encodeURIComponent(words)}&gsrlimit=5&${PAGE_PROPS}&exintro=1&exlimit=5`;
    const page = await this.fetcher.get(url, { ttlMs: TTL.day, tag });
    const pages: ApiPage[] = parseApi(page!.body, "search").query?.pages ?? [];
    return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((p) => toPage(p, false, page!.retrieved_at, page!.stale)).filter((p): p is WikiPage => !!p);
  }

  /** Game versions with release dates from the wiki's Cargo table, newest first. */
  async versions(refresh = false): Promise<{ versions: GameVersion[]; retrieved_at: string; url: string }> {
    const base = `${this.site.api}?action=cargoquery&tables=versions&fields=version,release_date&order_by=release_date+DESC&format=json`;
    const page = await this.fetcher.get(base, { ttlMs: TTL.short, refresh });
    const versions = parseVersions(page!.body);
    // The API returns the newest 50 rows (asking for more would need "limit=", which robots.txt disallows).
    // A second query for the x.y.0 releases reaches back years, so old pages still get the league they were written in.
    try {
      const launches = await this.fetcher.get(`${base}&where=${encodeURIComponent("version LIKE '%.0'")}`, { ttlMs: TTL.week });
      for (const v of parseVersions(launches!.body)) if (!versions.some((x) => x.version === v.version)) versions.push(v);
    } catch (error) {
      if (!(error instanceof KbError)) throw error;
    }
    return { versions, retrieved_at: page!.retrieved_at, url: this.site.api.replace("/w/api.php", "/wiki/Version_history") };
  }
}

export function parseVersions(body: string): GameVersion[] {
  const rows: Array<{ title?: Record<string, string> }> = parseApi(body, "the versions table").cargoquery ?? [];
  const out: GameVersion[] = [];
  for (const row of rows) {
    const version = row.title?.version?.trim();
    if (!version || !/^\d+\.\d+/.test(version)) continue;
    const date = /^\d{4}-\d{2}-\d{2}/.exec(row.title?.["release date"] ?? row.title?.release_date ?? "")?.[0];
    out.push({ version, ...(date ? { released: date } : {}) });
  }
  if (!out.length) throw new KbError("The wiki's versions table came back empty (the table or the API may have changed).");
  return out;
}

/**
 * How well a page title fits a question: 1 for the exact title, less when the
 * title covers only part of the question or has words the question lacks.
 */
export function titleFit(query: string, title: string): number {
  const q = keyWords(query), t = keyWords(title.replace(/\(.*?\)/g, ""));
  if (!q.length || !t.length) return 0;
  const shared = t.filter((w) => q.includes(w)).length;
  return (shared / t.length) * (shared / q.length);
}
