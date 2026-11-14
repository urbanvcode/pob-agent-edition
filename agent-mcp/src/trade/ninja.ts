// Ported from ianderse/pob-mcp (https://github.com/ianderse/pob-mcp, GPL-3.0), original file: src/services/poeNinjaClient.ts. (currency rates only).
// Licensed under the GNU General Public License v3.0; see LICENSE at the repository root.
/**
 * poe.ninja currency rates (chaos equivalents), used to compare listings
 * priced in different currencies, and unique/gem prices. Cached per league in
 * memory and on disk (AgentCache/economy); an older copy is used when poe.ninja is down.
 */
import fs from "fs";
import path from "path";
import { cacheDir, USER_AGENT } from "../paths.js";

interface Rate { id: string; primaryValue: number }
interface Item { id: string; name: string }

const cache = new Map<string, { at: number; rates: Map<string, number> }>();

/** Accepts both poe.ninja response generations; returns currency name -> chaos. */
export function parseRates(data: unknown): Map<string, number> {
  const d = (data ?? {}) as { lines?: unknown[]; items?: Item[]; core?: { primary?: string } };
  const rates = new Map<string, number>([["Chaos Orb", 1]]);
  const lines = Array.isArray(d.lines) ? d.lines : [];
  const first = lines[0] as Record<string, unknown> | undefined;
  if (first && "currencyTypeName" in first) {
    for (const l of lines as Array<{ currencyTypeName?: string; chaosEquivalent?: number }>) {
      if (l.currencyTypeName && l.chaosEquivalent && l.chaosEquivalent > 0) rates.set(l.currencyTypeName, l.chaosEquivalent);
    }
    return rates;
  }
  const items = Array.isArray(d.items) ? d.items : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const chaos = items.find((i) => i.name === "Chaos Orb");
  const chaosLine = chaos ? (lines as Rate[]).find((l) => l.id === chaos.id) : undefined;
  const chaosValue = chaosLine?.primaryValue ?? (d.core?.primary === "chaos" ? 1 : undefined);
  if (!chaosValue || !(chaosValue > 0)) throw new Error("poe.ninja reply had no usable Chaos Orb rate");
  for (const l of lines as Rate[]) {
    const item = byId.get(l.id);
    const value = l.primaryValue / chaosValue;
    if (item?.name && Number.isFinite(value) && value > 0) rates.set(item.name, value);
  }
  return rates;
}

export interface RatesInfo { rates: Map<string, number>; at: number; stale: boolean }

const RATES_FRESH_MS = 1_800_000; // 30 minutes on disk
const STALE_OK_MS = 3 * 86_400_000; // an older copy is used (and said) when poe.ninja is down

const safe = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 80);

function readDisk<T>(file: string): { at: number; data: T } | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cacheDir("economy"), file), "utf8"));
    return typeof j?.at === "number" ? j : undefined;
  } catch { return undefined; }
}

function writeDisk(file: string, data: unknown): void {
  try { fs.writeFileSync(path.join(cacheDir("economy"), file), JSON.stringify({ at: Date.now(), data })); } catch { /* cache only */ }
}

/** Rates with their age: memory (5 min), then disk (30 min), then poe.ninja; an old disk copy when poe.ninja fails. */
export async function ratesInfo(league: string): Promise<RatesInfo> {
  const hit = cache.get(league);
  if (hit && Date.now() - hit.at < 300_000) return { rates: hit.rates, at: hit.at, stale: false };
  const file = `rates-${safe(league)}.json`;
  const disk = readDisk<Array<[string, number]>>(file);
  if (disk && Date.now() - disk.at < RATES_FRESH_MS) {
    const rates = new Map(disk.data);
    cache.set(league, { at: disk.at, rates });
    return { rates, at: disk.at, stale: false };
  }
  try {
    const url = `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=Currency`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`poe.ninja request failed (${response.status})`);
    const rates = parseRates(await response.json());
    const at = Date.now();
    cache.set(league, { at, rates });
    writeDisk(file, [...rates]);
    return { rates, at, stale: false };
  } catch (e) {
    if (disk && Date.now() - disk.at < STALE_OK_MS) return { rates: new Map(disk.data), at: disk.at, stale: true };
    throw e;
  }
}

export async function currencyRates(league: string): Promise<Map<string, number>> {
  return (await ratesInfo(league)).rates;
}

// --- item prices (uniques, gems) ---------------------------------------------------
export const NINJA_ITEM_TYPES = ["UniqueWeapon", "UniqueArmour", "UniqueAccessory", "UniqueFlask", "UniqueJewel", "SkillGem"] as const;

/** One poe.ninja item line, trimmed to what pricing needs. */
export interface NinjaLine {
  name: string; baseType?: string; links?: number; variant?: string; chaosValue: number; listingCount?: number;
  gemLevel?: number; gemQuality?: number; corrupted?: boolean; change?: number;
}

const itemCache = new Map<string, { at: number; lines: NinjaLine[] }>();
const ITEMS_FRESH_MS = 7_200_000; // 2 hours

export function trimLines(raw: unknown): NinjaLine[] {
  const lines = Array.isArray((raw as { lines?: unknown })?.lines) ? (raw as { lines: any[] }).lines : [];
  return lines.filter((l) => l && typeof l.name === "string" && l.chaosValue > 0).map((l) => {
    const t: NinjaLine = { name: l.name, chaosValue: l.chaosValue };
    if (l.baseType) t.baseType = l.baseType;
    if (l.links) t.links = l.links;
    if (l.variant) t.variant = l.variant;
    if (typeof l.listingCount === "number") t.listingCount = l.listingCount;
    if (typeof l.gemLevel === "number") t.gemLevel = l.gemLevel;
    if (typeof l.gemQuality === "number") t.gemQuality = l.gemQuality;
    if (l.corrupted) t.corrupted = true;
    const change = l.sparkline?.totalChange ?? l.lowConfidenceSparkline?.totalChange;
    if (typeof change === "number" && Number.isFinite(change)) t.change = change;
    return t;
  });
}

/** poe.ninja item overview for a league and type: memory, then disk (2 h), then one download. */
export async function ninjaItemLines(league: string, type: string): Promise<NinjaLine[]> {
  const key = `${league}|${type}`;
  const hit = itemCache.get(key);
  if (hit && Date.now() - hit.at < ITEMS_FRESH_MS) return hit.lines;
  const file = `items-${safe(league)}-${safe(type)}.json`;
  const disk = readDisk<NinjaLine[]>(file);
  if (disk && Date.now() - disk.at < ITEMS_FRESH_MS) {
    itemCache.set(key, { at: disk.at, lines: disk.data });
    return disk.data;
  }
  try {
    const url = `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`poe.ninja ${type} request failed (${response.status})`);
    const lines = trimLines(await response.json());
    itemCache.set(key, { at: Date.now(), lines });
    writeDisk(file, lines);
    return lines;
  } catch (e) {
    if (disk && Date.now() - disk.at < STALE_OK_MS) return disk.data;
    throw e;
  }
}

// --- exchange categories (Fragment, Essence, Oil, ...) for the farming advisor -------------------
/** poe.ninja's trend and trade volume for one item: change = % over `days` (its sparkline, up to 7 days), volume in chaos. */
export interface Market { change?: number; days?: number; volume?: number }
export interface ExchangeInfo { prices: Map<string, number>; at: number; stale: boolean; market: Map<string, Market> }

/** Trend and volume per item name from an exchange overview reply (volumes converted to chaos like the prices). */
export function parseMarket(data: unknown): Map<string, Market> {
  const d = (data ?? {}) as { lines?: Array<Record<string, any>>; items?: Item[]; core?: { primary?: string } };
  const out = new Map<string, Market>();
  const lines = Array.isArray(d.lines) ? d.lines : [];
  const items = Array.isArray(d.items) ? d.items : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const chaos = items.find((i) => i.name === "Chaos Orb");
  const chaosValue = (chaos ? lines.find((l) => l.id === chaos.id)?.primaryValue : undefined) ?? (d.core?.primary === "chaos" ? 1 : undefined);
  for (const l of lines) {
    const name = byId.get(l.id)?.name;
    if (!name) continue;
    const m: Market = {};
    const spark = l.sparkline as { totalChange?: unknown; data?: unknown[] } | undefined;
    if (typeof spark?.totalChange === "number" && Number.isFinite(spark.totalChange)) {
      m.change = spark.totalChange;
      m.days = Array.isArray(spark.data) ? Math.max(1, spark.data.filter((x) => typeof x === "number").length) : undefined;
    }
    if (typeof l.volumePrimaryValue === "number" && chaosValue && chaosValue > 0) m.volume = l.volumePrimaryValue / chaosValue;
    if (m.change !== undefined || m.volume !== undefined) out.set(name, m);
  }
  return out;
}

type ExchangeRow = [string, number, Market?];

/** poe.ninja exchange overview of one category (name -> chaos): memory/disk 2 h, an older copy when poe.ninja is down. */
const marketCache = new Map<string, Map<string, Market>>();
export async function exchangePrices(league: string, type: string): Promise<ExchangeInfo> {
  const key = `x|${league}|${type}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ITEMS_FRESH_MS) return { prices: hit.rates, at: hit.at, stale: false, market: marketCache.get(key) ?? new Map() };
  const file = `exchange-${safe(league)}-${safe(type)}.json`;
  const disk = readDisk<ExchangeRow[]>(file);
  const fromDisk = (rows: ExchangeRow[]) => ({ prices: new Map(rows.map((r) => [r[0], r[1]] as [string, number])), market: new Map(rows.filter((r) => r[2]).map((r) => [r[0], r[2]!] as [string, Market])) });
  if (disk && Date.now() - disk.at < ITEMS_FRESH_MS) return { ...fromDisk(disk.data), at: disk.at, stale: false };
  try {
    const url = `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`poe.ninja ${type} request failed (${response.status})`);
    const body = await response.json() as { lines?: unknown[] };
    const prices = body?.lines?.length ? parseRates(body) : new Map<string, number>();
    prices.delete("Chaos Orb");
    const market = body?.lines?.length ? parseMarket(body) : new Map<string, Market>();
    const at = Date.now();
    cache.set(key, { at, rates: prices });
    marketCache.set(key, market);
    writeDisk(file, [...prices].map(([name, chaos]) => (market.has(name) ? [name, chaos, market.get(name)] : [name, chaos])));
    return { prices, at, stale: false, market };
  } catch (e) {
    if (disk && Date.now() - disk.at < STALE_OK_MS) return { ...fromDisk(disk.data), at: disk.at, stale: true };
    throw e;
  }
}
