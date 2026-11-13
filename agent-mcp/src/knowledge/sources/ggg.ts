/**
 * Official GGG patch notes: the "Patch Notes" forum on pathofexile.com.
 *
 * Only the first post of a thread (the staff post) is read; replies by players
 * are never parsed. Pages under /forum/view-forum and /forum/view-thread are
 * allowed by the site's robots.txt (its /api/ is not, so it is not used here).
 */
import { TTL, type PoliteFetcher } from "../fetcher.js";
import { decodeEntities, stripTags } from "../text.js";
import { KbError } from "../types.js";

const FORUM = "https://www.pathofexile.com/forum/view-forum/patch-notes";
const THREAD = "https://www.pathofexile.com/forum/view-thread/";

export interface PatchThread {
  /** e.g. "3.30.0", "3.29.3c". */
  version: string;
  title: string;
  url: string;
  /** A "Content Update" thread is posted days before the patch goes live. */
  contentUpdate: boolean;
}

export interface PatchLine {
  section: string;
  text: string;
  /** The line this one is nested under, when it is a sub-point. */
  parent?: string;
}

export interface PatchNotes extends PatchThread {
  /** ISO date-time of the staff post, when it could be read. */
  posted_at?: string;
  retrieved_at: string;
  lines: PatchLine[];
  stale?: boolean;
}

/** The forum's thread list -> threads that name a game version, newest first (the forum's own order). */
export function parseForumList(html: string): PatchThread[] {
  const out: PatchThread[] = [];
  const re = /<div class="title">\s*<a href="\/forum\/view-thread\/(\d+)">\s*([^<]+?)\s*<\/a>/g;
  let m: RegExpExecArray | null, threads = 0;
  while ((m = re.exec(html))) {
    threads++;
    const title = decodeEntities(m[2]).replace(/\s+/g, " ").trim();
    const version = /\b(\d+\.\d+\.\d+[a-z]?)\b/i.exec(title)?.[1];
    // Path of Exile 1 versions are 1.x and up; 0.x belongs to Path of Exile 2.
    if (!version || version.startsWith("0.")) continue;
    out.push({ version: version.toLowerCase(), title, url: THREAD + m[1], contentUpdate: /content update/i.test(title) });
  }
  if (!threads) throw new KbError("No threads found on the patch-notes forum page (pathofexile.com may have changed its layout).");
  return out;
}

/** "Nov 11, 2026, 5:10:59 AM" -> ISO, or undefined. */
function forumDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const ms = Date.parse(text.trim() + " UTC");
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** The first (staff) post of a patch-notes thread -> headed lines. */
export function parseThread(html: string): { lines: PatchLine[]; posted_at?: string } {
  const start = html.search(/<tr class="(?:newsPost|staff)">/);
  if (start < 0) throw new KbError("The patch-notes thread has no staff post where one is expected (the forum layout may have changed).");
  const rest = html.slice(start);
  const ends = [rest.search(/<tr class="newsPost newsPostInfo"/), rest.search(/<td class="post_info"/), rest.search(/<div class="signature"/)].filter((i) => i > 0);
  const post = ends.length ? rest.slice(0, Math.min(...ends)) : rest;
  const posted_at = forumDate(/class="post_date">([^<]+)/.exec(rest)?.[1]);

  const lines: PatchLine[] = [];
  const parents: string[] = [];
  let section = "", buffer = "", inHeading = false, last = "";
  const flush = () => {
    const text = stripTags(buffer);
    buffer = "";
    if (!text || /^return to top$/i.test(text) || /^table of contents$/i.test(section)) return;
    const parent = parents.filter(Boolean).pop();
    lines.push({ section, text, ...(parent ? { parent } : {}) });
    last = text;
  };
  for (const token of post.replace(/<style[\s\S]*?<\/style>/gi, "").split(/(<\/?(?:h[1-4]|li|ul|ol|br|p|div)\b[^>]*>)/i)) {
    const tag = /^<(\/?)(h[1-4]|li|ul|ol|br|p|div)\b/i.exec(token);
    if (!tag) { buffer += token; continue; }
    const closing = tag[1] === "/", name = tag[2].toLowerCase();
    if (/^h[1-4]$/.test(name)) {
      if (!closing) { flush(); inHeading = true; }
      else if (inHeading) { section = stripTags(buffer); buffer = ""; inHeading = false; last = ""; parents.length = 0; }
      continue;
    }
    if (inHeading) continue;
    flush();
    // A list opened inside a list item: its lines are sub-points of the line just read.
    if (name === "ul" || name === "ol") {
      if (!closing) { parents.push(parents.length ? last : ""); }
      else { parents.pop(); last = ""; }
    }
  }
  flush();
  // The thread title is repeated as the first heading with no lines of its own; drop empty noise.
  return { lines: lines.filter((l) => l.text.length > 1), posted_at };
}

export class GggPatchNotes {
  constructor(private readonly fetcher: PoliteFetcher) {}

  /** Threads on the first `pages` pages of the forum, newest first. */
  async list(pages = 1, refresh = false): Promise<{ threads: PatchThread[]; retrieved_at: string; url: string; stale?: boolean }> {
    const threads: PatchThread[] = [];
    let retrieved_at = "", stale = false;
    for (let n = 1; n <= pages; n++) {
      const page = await this.fetcher.get(n === 1 ? FORUM : `${FORUM}/page/${n}`, { ttlMs: TTL.short, refresh });
      for (const t of parseForumList(page!.body)) if (!threads.some((x) => x.url === t.url)) threads.push(t);
      retrieved_at ||= page!.retrieved_at;
      stale ||= !!page!.stale;
    }
    return { threads, retrieved_at, url: FORUM, ...(stale ? { stale } : {}) };
  }

  async notes(thread: PatchThread): Promise<PatchNotes> {
    const page = await this.fetcher.get(thread.url, { ttlMs: TTL.week });
    const parsed = parseThread(page!.body);
    return { ...thread, ...parsed, retrieved_at: page!.retrieved_at, ...(page!.stale ? { stale: true } : {}) };
  }
}
