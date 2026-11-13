/**
 * poe.ninja build data (Stage 11): how many characters of a league use each
 * class/ascendancy, main skill, unique and keystone, and the top characters for
 * a filter (their PoB export is the template for a new build).
 *
 * poe.ninja serves the build search as protobuf and its name lists as "NDIC"
 * dictionaries; both are read here without a schema (only the fields we need).
 * Polite: robots.txt only disallows /dev/; at most one request per second and
 * MAX_REQUESTS per tool call; replies cached on disk (AgentCache/create).
 * If poe.ninja changes its format the reader throws a clear error instead of guessing.
 */
import fs from "fs";
import path from "path";
import { cacheDir, USER_AGENT } from "../paths.js";

const BASE = "https://poe.ninja/poe1/api";
const SEARCH_FRESH_MS = 3_600_000; // 1 hour
const STALE_OK_MS = 3 * 86_400_000;
export const MAX_REQUESTS = 10;

// --- protobuf wire format (no schema) --------------------------------------------------
interface Field { f: number; v?: number; b?: Buffer }

function varint(b: Buffer, p: number): [number, number] {
  let r = 0, m = 1;
  for (let i = 0; i < 10; i++) {
    if (p >= b.length) throw new Error("truncated varint");
    const x = b[p++];
    r += (x & 127) * m;
    m *= 128;
    if (!(x & 128)) return [r, p];
  }
  throw new Error("bad varint");
}

export function fields(b: Buffer): Field[] {
  const out: Field[] = [];
  let p = 0;
  while (p < b.length) {
    let k: number;
    [k, p] = varint(b, p);
    const f = Math.floor(k / 8), w = k & 7;
    if (w === 0) { let v: number; [v, p] = varint(b, p); out.push({ f, v }); }
    else if (w === 2) { let l: number; [l, p] = varint(b, p); if (p + l > b.length) throw new Error("truncated field"); out.push({ f, b: b.subarray(p, p + l) }); p += l; }
    else if (w === 5) { out.push({ f, v: b.readFloatLE(p) }); p += 4; }
    else if (w === 1) { out.push({ f, v: b.readDoubleLE(p) }); p += 8; }
    else throw new Error(`wire type ${w}`);
  }
  return out;
}

const text = (x?: Field) => (x?.b ? x.b.toString("utf8") : "");
const packed = (b?: Buffer) => { const out: number[] = []; let p = 0; while (b && p < b.length) { let v: number; [v, p] = varint(b, p); out.push(v); } return out; };

/**
 * "NDIC" name list: a 36-byte header (count at 12, chunk count at 28), one 8-byte
 * entry per chunk of 16 names (string offset, first index), N one-byte lengths,
 * then the names back to back. Checked: the lengths must add up to the rest.
 */
export function parseDictionary(b: Buffer): string[] {
  if (b.length < 36 || b.toString("latin1", 0, 4) !== "NDIC") throw new Error("poe.ninja dictionary has an unknown format");
  const n = b.readUInt32LE(12), chunks = b.readUInt32LE(28);
  const p = 36 + 8 * chunks;
  let sum = 0;
  for (let i = 0; i < n && p + i < b.length; i++) sum += b[p + i];
  if (p + n > b.length || sum !== b.length - (p + n)) throw new Error("poe.ninja dictionary has an unknown format");
  const names: string[] = [];
  let o = p + n;
  for (let i = 0; i < n; i++) { names.push(b.toString("utf8", o, o + b[p + i])); o += b[p + i]; }
  return names;
}

export interface Dimension { id: string; dictionary: string; counts: Array<[number, number]> }
export interface RawSearch {
  total: number;
  dimensions: Dimension[];
  dictionaries: Record<string, string>;
  /** Top characters for the filter, in poe.ninja's order. */
  characters: Array<{ name: string; account: string; classIndex?: number }>;
  /** Dictionary of the characters' class column. */
  classDictionary?: string;
}

export function parseSearch(b: Buffer): RawSearch {
  const top = fields(b).find((x) => x.f === 1 && x.b);
  if (!top?.b) throw new Error("poe.ninja build search has an unknown format");
  const out: RawSearch = { total: 0, dimensions: [], dictionaries: {}, characters: [] };
  let names: string[] = [], accounts: string[] = [], classes: number[] = [];
  for (const x of fields(top.b)) {
    if (x.f === 1 && x.v !== undefined) out.total = x.v;
    else if (x.f === 2 && x.b) {
      const d = fields(x.b);
      const counts: Array<[number, number]> = [];
      for (const e of d.filter((y) => y.f === 3 && y.b)) {
        const kv = fields(e.b!);
        counts.push([kv.find((y) => y.f === 1)?.v ?? 0, kv.find((y) => y.f === 2)?.v ?? 0]);
      }
      out.dimensions.push({ id: text(d.find((y) => y.f === 1)), dictionary: text(d.find((y) => y.f === 2)), counts });
    } else if (x.f === 6 && x.b) {
      const d = fields(x.b);
      const name = text(d.find((y) => y.f === 1)), hash = text(d.find((y) => y.f === 2));
      if (name && /^[0-9a-f]{40}$/.test(hash)) out.dictionaries[name] = hash;
    } else if (x.f === 12 && x.b) {
      const d = fields(x.b);
      const id = text(d.find((y) => y.f === 1));
      const values = d.filter((y) => y.f === 7).map(text);
      if (id === "name") names = values;
      if (id === "account") accounts = values;
      if (id === "class") { classes = packed(d.find((y) => y.f === 6)?.b); out.classDictionary = text(d.find((y) => y.f === 11)) || "class"; }
    }
  }
  if (!out.total && !out.dimensions.length) throw new Error("poe.ninja build search has an unknown format");
  out.characters = names.map((name, i) => ({ name, account: accounts[i] ?? "", classIndex: classes[i] })).filter((c) => c.name && c.account);
  return out;
}

// --- HTTP: polite, cached -----------------------------------------------------------
type Fetch = (url: string) => Promise<{ ok: boolean; status: number; buffer: Buffer }>;

const realFetch: Fetch = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  return { ok: r.ok, status: r.status, buffer: Buffer.from(await r.arrayBuffer()) };
};

export class NinjaBuilds {
  private requests = 0;
  private last = 0;
  constructor(private get: Fetch = realFetch, private dir: () => string = () => cacheDir("create")) {}

  /** A new tool call: a fresh request allowance. */
  beginCall(): void { this.requests = 0; }

  private file(key: string) { return path.join(this.dir(), key.replace(/[^\w.-]+/g, "_").slice(0, 120)); }

  private async fetchCached(key: string, url: string, freshMs: number): Promise<{ buffer: Buffer; at: number; stale: boolean }> {
    const file = this.file(key);
    let disk: { at: number; buffer: Buffer } | undefined;
    try { const st = fs.statSync(file); disk = { at: st.mtimeMs, buffer: fs.readFileSync(file) }; } catch { /* not cached */ }
    if (disk && Date.now() - disk.at < freshMs) return { ...disk, stale: false };
    if (this.requests >= MAX_REQUESTS) {
      if (disk) return { ...disk, stale: true };
      throw new Error(`Stopped after ${MAX_REQUESTS} poe.ninja requests for this question (polite limit); ask again for more.`);
    }
    const wait = this.last + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.requests++;
    this.last = Date.now();
    try {
      const r = await this.get(url);
      if (!r.ok) throw new Error(`poe.ninja answered ${r.status}`);
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, r.buffer); } catch { /* cache only */ }
      return { buffer: r.buffer, at: Date.now(), stale: false };
    } catch (e) {
      if (disk && Date.now() - disk.at < STALE_OK_MS) return { ...disk, stale: true };
      throw e;
    }
  }

  /** The current build snapshot of a league (poe.ninja's league name, e.g. "Covens" or "Hardcore Covens"). */
  async snapshot(league: string): Promise<{ version: string; url: string; name: string; tree?: string }> {
    const { buffer } = await this.fetchCached("index-state.json", `${BASE}/data/index-state`, 600_000);
    const j = JSON.parse(buffer.toString("utf8")) as { snapshotVersions?: Array<{ url: string; type: string; name: string; version: string; passiveTree?: string }> };
    const list = (j.snapshotVersions ?? []).filter((s) => s.type === "exp");
    const want = league.trim().toLowerCase();
    const hit = list.find((s) => s.name.toLowerCase() === want) ?? list.find((s) => s.url === want);
    if (!hit) throw new Error(`poe.ninja has no build data for "${league}". It has: ${list.map((s) => s.name).join(", ")}.`);
    return { version: hit.version, url: hit.url, name: hit.name, tree: hit.passiveTree };
  }

  async dictionary(hash: string): Promise<string[]> {
    const { buffer } = await this.fetchCached(`dict-${hash}.bin`, `${BASE}/builds/dictionary/${hash}`, 30 * 86_400_000);
    return parseDictionary(buffer);
  }

  /** Counts per class, skill, unique and keystone for a filter, with names; plus the top characters. */
  async search(league: string, filter: { class?: string; skills?: string; items?: string } = {}): Promise<BuildSearch> {
    const snap = await this.snapshot(league);
    const params = new URLSearchParams({ overview: snap.url, type: "exp" });
    for (const [k, v] of Object.entries(filter)) if (v) params.set(k, v);
    const key = `search-${snap.version}-${params.toString()}.pb`;
    const r = await this.fetchCached(key, `${BASE}/builds/${snap.version}/search?${params}`, SEARCH_FRESH_MS);
    const raw = parseSearch(r.buffer);
    const named = new Map<string, Array<{ name: string; count: number }>>();
    for (const id of ["class", "skills", "items", "keypassives", "allgems"]) {
      const dim = raw.dimensions.find((d) => d.id === id);
      const hash = dim && raw.dictionaries[dim.dictionary];
      if (!dim || !hash) continue;
      const names = await this.dictionary(hash);
      named.set(id, dim.counts.filter(([, c]) => c > 0).map(([i, c]) => ({ name: names[i] ?? `#${i}`, count: c })).sort((a, b) => b.count - a.count));
    }
    const classHash = raw.dictionaries[raw.classDictionary ?? "class"];
    const classNames = classHash ? await this.dictionary(classHash).catch(() => [] as string[]) : [];
    const characters = raw.characters.map((c) => ({ name: c.name, account: c.account, className: c.classIndex !== undefined ? classNames[c.classIndex] : undefined }));
    return { league: snap.name, version: snap.version, url: snap.url, at: r.at, stale: r.stale, total: raw.total, filter, counts: named, characters };
  }

  /** One character from the snapshot: its PoB export code, class and level. */
  async character(league: string, account: string, name: string): Promise<NinjaCharacter> {
    const snap = await this.snapshot(league);
    const params = new URLSearchParams({ account, name, overview: snap.url, type: "exp" });
    const r = await this.fetchCached(`char-${snap.version}-${account}-${name}.json`, `${BASE}/builds/${snap.version}/character?${params}`, SEARCH_FRESH_MS);
    const j = JSON.parse(r.buffer.toString("utf8")) as Record<string, any>;
    if (typeof j.pathOfBuildingExport !== "string" || !j.pathOfBuildingExport) throw new Error("poe.ninja has no PoB export for this character.");
    return {
      code: j.pathOfBuildingExport, level: Number(j.level) || 0, className: String(j.ascendancyClassName || j.class || j.baseClass || ""),
      league: snap.name, at: r.at, link: `https://poe.ninja/poe1/builds/${snap.url}/character/${encodeURIComponent(account)}/${encodeURIComponent(name)}`,
    };
  }
}

export interface BuildSearch {
  league: string; version: string; url: string; at: number; stale: boolean; total: number;
  filter: Record<string, string | undefined>;
  counts: Map<string, Array<{ name: string; count: number }>>;
  characters: Array<{ name: string; account: string; className?: string }>;
}

export interface NinjaCharacter { code: string; level: number; className: string; league: string; at: number; link: string }

/** The poe.ninja builds page for a filter (for the player to look at). */
export function buildsPage(s: Pick<BuildSearch, "url" | "filter">): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(s.filter)) if (v) params.set(k, v);
  const q = params.toString();
  return `https://poe.ninja/poe1/builds/${s.url}${q ? `?${q}` : ""}`;
}
