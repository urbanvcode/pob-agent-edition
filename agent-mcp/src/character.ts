/**
 * Character import and progress history (Stage 2).
 *
 * Downloads a character from pathofexile.com's public profile endpoints (the
 * same ones PoB's Import tab uses for "account name" imports), politely: one
 * request every 2 s, every rate-limit tier the server publishes is respected
 * before it is reached, a handful of requests per sync, and nothing is retried
 * after the site asks for a pause. Read-only: no login, no password, no
 * POESESSID, no game client.
 *
 * Every sync stores a compact state (level, PoB's stats, items, gems, passives)
 * in Documents/Path of Building/AgentCache/history/<character>.json; the
 * Overview "Progress" card in PoB Agent Edition reads the same file.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { cacheDir, USER_AGENT } from "./paths.js";
import { ToolError } from "./pob.js";
import { RateGovernor } from "./trade/rateGovernor.js";

const HOST = "https://www.pathofexile.com/";
export const REALMS = ["pc", "xbox", "sony"];

// ---------------------------------------------------------------------------
// Download

export interface CharacterEntry { name: string; league: string; class: string; level: number; realm?: string; [k: string]: unknown }
export interface Downloaded { account: string; character: CharacterEntry; items: any; passives: any; requests: number }

type Fetcher = (url: string) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

/** PoB's account-name clean-up (ImportTab:DownloadSiteCharacterList): "Name-1234" / "Name#1234". */
export function normaliseAccount(account: string, realm = "pc"): string {
  let a = account.trim();
  a = realm === "pc" ? a.replace(/\s+/g, "") : a.replace(/\s/g, "+");
  return a.replace(/^(.*)[#-](\d{4})$/, "$1#$2");
}

export class CharacterClient {
  private readonly governor: RateGovernor;
  private last = 0;
  constructor(private readonly fetcher: Fetcher = (url) => fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }),
    private readonly minGapMs = 2000, governor?: RateGovernor, private readonly maxWaitMs = 45_000) {
    this.governor = governor ?? new RateGovernor();
  }

  private async get(url: string, budget: { left: number }): Promise<{ status: number; body: string }> {
    if (budget.left <= 0) throw new ToolError("Request budget for this sync is used up; try again in a minute.");
    const blocked = this.governor.blockedForSec();
    if (blocked > 0) throw new ToolError(`pathofexile.com asked for a pause: wait ${blocked} s before syncing again. Do not retry in a loop.`);
    const wait = Math.max(this.governor.waitMs("character"), this.last + this.minGapMs - Date.now());
    if (wait > this.maxWaitMs) throw new ToolError(`pathofexile.com's character limit is nearly used; wait ${Math.ceil(wait / 1000)} s and sync again.`);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    budget.left--;
    this.governor.record("character");
    this.last = Date.now();
    const res = await this.fetcher(url);
    this.governor.update("character", res.headers, res.status);
    const body = await res.text();
    if (res.status === 429) throw new ToolError(`pathofexile.com asked for a pause (429). Wait ${this.governor.blockedForSec() || 60} s; do not retry in a loop.`);
    return { status: res.status, body };
  }

  private json(body: string, what: string): any {
    try { return JSON.parse(body); } catch { throw new ToolError(`pathofexile.com sent an unreadable ${what}; try again later.`); }
  }

  async characters(account: string, realm: string, budget = { left: 1 }): Promise<CharacterEntry[]> {
    const url = `${HOST}character-window/get-characters?accountName=${encodeURIComponent(account)}&realm=${realm}`;
    const res = await this.get(url, budget);
    if (res.status === 401 || res.status === 403) {
      throw new ToolError(`The profile of ${account} is private or does not exist. The player can make the Characters tab public at pathofexile.com > My Account > Privacy Settings (never ask for a password or POESESSID).`);
    }
    if (res.status === 404) throw new ToolError(`No account named ${account}. Account names include the #1234 tag, e.g. Name#1234.`);
    if (res.status !== 200) throw new ToolError(`pathofexile.com answered ${res.status} for the character list; try again later.`);
    const list = this.json(res.body, "character list");
    if (!Array.isArray(list)) throw new ToolError("pathofexile.com sent no character list.");
    return list as CharacterEntry[];
  }

  /** Character list + items + passive tree: 3 requests. */
  async download(accountIn: string, characterIn: string, realm = "pc"): Promise<Downloaded> {
    const budget = { left: 4 };
    const account = normaliseAccount(accountIn, realm);
    const list = await this.characters(account, realm, budget);
    const want = characterIn.trim().toLowerCase();
    const character = list.find((c) => c.name.toLowerCase() === want);
    if (!character) {
      const names = list.slice().sort((a, b) => b.level - a.level).slice(0, 12).map((c) => `${c.name} (${c.level} ${c.class}, ${c.league})`);
      throw new ToolError(`${account} has no character "${characterIn}". Characters: ${names.join(", ") || "none"}.`);
    }
    const q = `accountName=${encodeURIComponent(account)}&character=${encodeURIComponent(character.name)}&realm=${realm}`;
    const items = await this.get(`${HOST}character-window/get-items?${q}`, budget);
    if (items.status !== 200 || items.body === "false") throw new ToolError(`pathofexile.com did not send the items of ${character.name} (${items.status}); try again later.`);
    const passives = await this.get(`${HOST}character-window/get-passive-skills?${q}`, budget);
    if (passives.status !== 200 || passives.body === "false") throw new ToolError(`pathofexile.com did not send the passive tree of ${character.name} (${passives.status}); try again later.`);
    return { account, character, items: this.json(items.body, "item list"), passives: this.json(passives.body, "passive tree"), requests: 4 - budget.left };
  }
}

// ---------------------------------------------------------------------------
// History store

export interface ItemState { slot: string; name: string; base?: string; rarity?: string; mods?: string }
export interface GemState { name: string; level: number; quality: number; support?: boolean; slot?: string; enabled?: boolean }
export interface CharacterState {
  name?: string; level: number; className?: string; ascendancy?: string; mainSkill?: string;
  stats: Record<string, number | undefined>; assumptions?: string; characterHash?: string;
  items: ItemState[]; gems: GemState[]; nodes: number[]; named: Record<string, string>; pointsUsed?: number;
}
export interface HistoryEntry extends CharacterState { at: string; league?: string; snapshot?: string; summary?: string; fight?: FightSettings }
export interface History {
  version: 1; account: string; realm: string; character: string; characterHash: string; league?: string;
  build?: string; entries: HistoryEntry[];
}

const MAX_ENTRIES = 200;
const MAX_SNAPSHOTS = 30;

export const historyDir = (): string => cacheDir("history");
const safe = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 80);
export const characterHash = (name: string): string => crypto.createHash("sha1").update(name).digest("hex");

export function historyFile(realm: string, account: string, character: string): string {
  return path.join(historyDir(), `${safe(realm)}_${safe(account)}_${safe(character)}.json`);
}

export function readHistory(file: string): History | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as History; } catch { return null; }
}

function writeJson(file: string, value: unknown): void {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

export function writeHistory(file: string, h: History): void {
  while (h.entries.length > MAX_ENTRIES) h.entries.splice(1, 1); // keep the first sync as the baseline
  writeJson(file, h);
}

/** The XML of this sync, so compare can use it ("snapshot" files next to the history). */
export function saveSnapshot(file: string, at: string, xml: string): string {
  const dir = file.replace(/\.json$/, "");
  fs.mkdirSync(dir, { recursive: true });
  const name = at.replace(/[:.]/g, "-") + ".xml";
  fs.writeFileSync(path.join(dir, name), xml);
  const all = fs.readdirSync(dir).filter((f) => f.endsWith(".xml")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS))) fs.rmSync(path.join(dir, old), { force: true });
  return path.join(dir, name);
}

/**
 * history/index.json: the last synced character (so "sync my character" needs no
 * names the second time) and a small timeline per character for the Overview
 * "Progress" card, keyed by sha1(character name) like PoB's lastCharacterHash.
 */
export interface TimelinePoint { at: string; level: number; dps: number; ehp: number; life: number; es: number; maxHit: number; summary?: string }
export interface HistoryIndex {
  last?: { account: string; realm: string; character: string };
  characters?: Record<string, { name: string; league?: string; build?: string; mainSkill?: string; timeline: TimelinePoint[] }>;
}
const indexFile = () => path.join(historyDir(), "index.json");
export function readIndex(): HistoryIndex {
  try { return JSON.parse(fs.readFileSync(indexFile(), "utf8")) as HistoryIndex; } catch { return {}; }
}
export function lastSynced(): HistoryIndex["last"] | null {
  return readIndex().last ?? null;
}
export function updateIndex(h: History): void {
  const index = readIndex();
  index.last = { account: h.account, realm: h.realm, character: h.character };
  index.characters = index.characters ?? {};
  const e = h.entries.at(-1);
  index.characters[h.characterHash] = {
    name: h.character, league: h.league, build: h.build, mainSkill: e?.mainSkill,
    timeline: h.entries.map((x) => ({ at: x.at, level: x.level, dps: Math.round(dps(x.stats)), ehp: Math.round(x.stats.TotalEHP ?? 0),
      life: Math.round(x.stats.Life ?? 0), es: Math.round(x.stats.EnergyShield ?? 0), maxHit: Math.round(maxHit(x.stats)), summary: x.summary })),
  };
  writeJson(indexFile(), index);
}

/** All stored histories, newest sync first. */
export function listHistories(): Array<{ file: string; history: History }> {
  let names: string[] = [];
  try { names = fs.readdirSync(historyDir()).filter((f) => f.endsWith(".json") && f !== "index.json"); } catch { /* none */ }
  return names.map((f) => ({ file: path.join(historyDir(), f), history: readHistory(path.join(historyDir(), f)) }))
    .filter((x): x is { file: string; history: History } => !!x.history && Array.isArray(x.history.entries))
    .sort((a, b) => (b.history.entries.at(-1)?.at ?? "").localeCompare(a.history.entries.at(-1)?.at ?? ""));
}

// ---------------------------------------------------------------------------
// Diff

export const dps = (s: Record<string, number | undefined>): number => {
  if ((s.FullDPS ?? 0) > 0) return s.FullDPS!;
  return s.CombinedDPS ?? s.TotalDPS ?? 0;
};
export const maxHit = (s: Record<string, number | undefined>): number => {
  const v = ["Physical", "Fire", "Cold", "Lightning", "Chaos"].map((t) => s[`${t}MaximumHitTaken`]).filter((x): x is number => typeof x === "number" && x > 0);
  return v.length ? Math.min(...v) : 0;
};

export interface Diff {
  level: [number, number];
  headline: Array<{ label: string; before: number; after: number }>;
  items: string[];
  gems: string[];
  passives: string[];
  counts: { items: number; gems: number; passives: number };
}

const itemLabel = (i: ItemState) => `${i.name}${i.base && !i.name.includes(i.base) ? ` (${i.base})` : ""}`;

export function diffStates(before: CharacterState, after: CharacterState): Diff {
  const b = before.stats ?? {}, a = after.stats ?? {};
  const headline = [
    { label: "DPS", before: dps(b), after: dps(a) },
    { label: "EHP", before: b.TotalEHP ?? 0, after: a.TotalEHP ?? 0 },
    { label: "Weakest max hit", before: maxHit(b), after: maxHit(a) },
    { label: "Life", before: b.Life ?? 0, after: a.Life ?? 0 },
    { label: "Energy shield", before: b.EnergyShield ?? 0, after: a.EnergyShield ?? 0 },
    ...["Fire", "Cold", "Lightning", "Chaos"].map((t) => ({ label: `${t} res`, before: b[`${t}Resist`] ?? 0, after: a[`${t}Resist`] ?? 0 })),
  ];

  // Items, slot by slot.
  const items: string[] = [];
  const bySlot = (list: ItemState[]) => new Map((list ?? []).map((i) => [i.slot, i]));
  const bi = bySlot(before.items), ai = bySlot(after.items);
  for (const slot of [...new Set([...bi.keys(), ...ai.keys()])]) {
    const x = bi.get(slot), y = ai.get(slot);
    if (x && !y) items.push(`${slot}: removed ${itemLabel(x)}`);
    else if (!x && y) items.push(`${slot}: new ${itemLabel(y)}`);
    else if (x && y && (x.name !== y.name || x.base !== y.base)) items.push(`${slot}: ${itemLabel(x)} -> ${itemLabel(y)}`);
    else if (x && y && x.mods !== y.mods) items.push(`${slot}: ${itemLabel(y)} has changed mods (crafted, rerolled or a different copy)`);
  }

  // Gems by name (a gem used twice is matched in order).
  const gems: string[] = [];
  const group = (list: GemState[]) => {
    const m = new Map<string, GemState[]>();
    for (const g of list ?? []) { const k = g.name; m.set(k, [...(m.get(k) ?? []), g]); }
    return m;
  };
  const bg = group(before.gems), ag = group(after.gems);
  for (const name of [...new Set([...bg.keys(), ...ag.keys()])]) {
    const xs = bg.get(name) ?? [], ys = ag.get(name) ?? [];
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      const x = xs[i], y = ys[i];
      if (x && !y) gems.push(`removed ${name} ${x.level}/${x.quality}`);
      else if (!x && y) gems.push(`new ${name} ${y.level}/${y.quality}${y.slot ? ` (${y.slot})` : ""}`);
      else if (x && y && (x.level !== y.level || x.quality !== y.quality)) gems.push(`${name} ${x.level}/${x.quality} -> ${y.level}/${y.quality}`);
    }
  }

  // Passives: named nodes by name, the rest counted.
  const passives: string[] = [];
  const bn = new Set(before.nodes ?? []), an = new Set(after.nodes ?? []);
  const added = [...an].filter((id) => !bn.has(id)), removed = [...bn].filter((id) => !an.has(id));
  const named = (ids: number[], names: Record<string, string>) => ids.map((id) => names?.[String(id)]).filter(Boolean) as string[];
  const addedNamed = named(added, after.named), removedNamed = named(removed, before.named);
  if (addedNamed.length) passives.push(`allocated: ${addedNamed.join(", ")}`);
  if (removedNamed.length) passives.push(`refunded: ${removedNamed.join(", ")}`);
  const smallAdded = added.length - addedNamed.length, smallRemoved = removed.length - removedNamed.length;
  if (smallAdded > 0 || smallRemoved > 0) passives.push(`small passives: +${smallAdded} / -${smallRemoved}`);
  // Masteries can change effect without the node changing.
  for (const id of [...an].filter((x) => bn.has(x))) {
    const x = before.named?.[String(id)], y = after.named?.[String(id)];
    if (x && y && x !== y) passives.push(`changed ${x} -> ${y.replace(/^[^:]+: /, "")}`);
  }

  return {
    level: [before.level, after.level],
    headline, items, gems, passives,
    counts: { items: items.length, gems: gems.length, passives: added.length + removed.length },
  };
}

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
function change(before: number, after: number, absolute: boolean): string {
  const d = after - before;
  if (absolute || before === 0) return `${d >= 0 ? "+" : ""}${fmt(d)}`;
  return `${d >= 0 ? "+" : ""}${((d / Math.abs(before)) * 100).toFixed(1)}%`;
}

export function diffText(d: Diff): string[] {
  const lines: string[] = [];
  lines.push(d.level[0] !== d.level[1] ? `Level ${d.level[0]} -> ${d.level[1]}` : `Level ${d.level[1]} (unchanged)`);
  const moved = d.headline.filter((h) => Math.abs(h.after - h.before) > Math.max(Math.abs(h.before) * 1e-4, 0.5));
  lines.push(...(moved.length ? moved.map((h) => `${h.label}: ${fmt(h.before)} -> ${fmt(h.after)} (${change(h.before, h.after, h.label.endsWith("res"))})`) : ["Stats: no change"]));
  lines.push(`ITEMS (${d.items.length} changed)`, ...d.items.map((s) => `- ${s}`));
  lines.push(`GEMS (${d.gems.length} changed)`, ...d.gems.slice(0, 30).map((s) => `- ${s}`), ...(d.gems.length > 30 ? [`- ... ${d.gems.length - 30} more`] : []));
  lines.push(`PASSIVES (${d.counts.passives} nodes changed)`, ...d.passives.map((s) => `- ${s}`));
  return lines;
}

/** One-line summary stored with each entry (the Progress card shows it). */
export function diffSummary(d: Diff): string {
  const parts: string[] = [];
  if (d.level[0] !== d.level[1]) parts.push(`level ${d.level[0]}->${d.level[1]}`);
  const p = d.headline[0];
  if (p.before > 0 && Math.abs(p.after - p.before) > p.before * 1e-4) parts.push(`DPS ${change(p.before, p.after, false)}`);
  const e = d.headline[1];
  if (e.before > 0 && Math.abs(e.after - e.before) > e.before * 1e-4) parts.push(`EHP ${change(e.before, e.after, false)}`);
  if (d.counts.items || d.gems.length || d.counts.passives) parts.push(`${d.counts.items} items, ${d.gems.length} gems, ${d.counts.passives} passives changed`);
  return parts.join(", ") || "no changes";
}

// ---------------------------------------------------------------------------
// Same character in another build (fight settings on a first sync)

export interface SameCharacterBuild { file: string; name: string; byImport: boolean; mtime: number }

/**
 * Builds in the Builds folder that are clearly the same character: same class and
 * ascendancy, and either an import of it (PoB stores a hash of the character name)
 * or the character's name in the build name. The synced build itself and guides
 * are left out. Best first: imports, then the newest.
 */
export function findSameCharacterBuilds(dir: string, character: string, className: string | undefined, ascendancy: string | undefined, exclude: string[] = [], maxFiles = 400): SameCharacterBuild[] {
  const hash = characterHash(character);
  const want = character.toLowerCase();
  const skip = new Set(exclude.map((f) => path.resolve(f).toLowerCase()));
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    let list: fs.Dirent[] = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (files.length >= maxFiles) return;
      const f = path.join(d, e.name);
      if (e.isDirectory() && depth < 2) walk(f, depth + 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".xml")) files.push(f);
    }
  };
  walk(dir, 0);
  const out: SameCharacterBuild[] = [];
  for (const file of files) {
    if (skip.has(path.resolve(file).toLowerCase())) continue;
    const name = path.basename(file, path.extname(file));
    if (/^Guide - /i.test(name)) continue;
    let xml: string;
    try { xml = fs.readFileSync(file, "utf8"); } catch { continue; }
    const tag = xml.match(/<Build\b[^>]*>/)?.[0] ?? "";
    const attr = (t: string, k: string) => t.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1];
    if (className && attr(tag, "className") !== className) continue;
    if (ascendancy && ascendancy !== "None" && attr(tag, "ascendClassName") !== ascendancy) continue;
    const imp = xml.match(/<Import\b[^>]*>/)?.[0] ?? "";
    const byImport = attr(imp, "lastCharacterHash") === hash;
    if (!byImport && !(want.length >= 3 && name.toLowerCase().includes(want))) continue;
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { /* ignore */ }
    out.push({ file, name, byImport, mtime });
  }
  return out.sort((a, b) => Number(b.byImport) - Number(a.byImport) || b.mtime - a.mtime);
}

export interface FightSettings { config: Record<string, unknown>; gems: Record<string, boolean> }
export interface ConfigEffect {
  diffs: { key: string; label: string; now: string; other: string }[];
  gems: { name: string; now: boolean; other: boolean }[];
  ops: unknown[];
  before?: Record<string, number>; after?: Record<string, number>;
}

/** "Trinity: lowest Resonance count 0 -> 50, Anger off" for a config_effect result, from "now" to "other". */
export function configEffectText(e: ConfigEffect, reverse = false): string {
  const parts = [
    ...e.diffs.map((d) => `${d.label} ${reverse ? d.other : d.now} -> ${reverse ? d.now : d.other}`),
    ...e.gems.map((g) => `${g.name} switched ${(reverse ? g.now : g.other) ? "on" : "off"}`),
  ];
  return parts.join(", ");
}

/** Plain JSON object (Lua sends an empty table as []). */
export const asObject = <T>(v: unknown): Record<string, T> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, T> : {});
