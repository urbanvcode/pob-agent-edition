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
  gemLevel?: number; gemQuality?: number; corrupted?: boolean;
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
