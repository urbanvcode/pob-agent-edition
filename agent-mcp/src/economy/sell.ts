/**
 * What the player's own items are worth (Stage 5): uniques and gems priced
 * from poe.ninja (no trade requests; poe.ninja already smooths out bait
 * listings), rares listed as "price by hand". Items that are not equipped and
 * gems that sit in no enabled group are the first things to sell; items a
 * plan replaces become sellable once the new one is bought.
 */
import type { NinjaLine } from "../trade/ninja.js";
import { ninjaItemLines } from "../trade/ninja.js";

export interface OwnItem { id: number; name: string; baseName?: string; rarity?: string; type?: string; corrupted?: boolean; links?: number; slot?: string; otherSet?: boolean }
export interface OwnGem { name: string; level: number; quality: number; support?: boolean; enabled?: boolean; group?: number; slot?: string }

export interface Priced {
  kind: "item" | "gem";
  name: string;
  slot?: string;
  chaos?: number;
  /** How the price was found, or why there is none. */
  basis: string;
  /** Not equipped and in no other item set: sell now. */
  spare: boolean;
  id?: number;
}

function ninjaType(item: OwnItem): string | undefined {
  const t = item.type ?? "";
  if (/Flask|Tincture/.test(t)) return "UniqueFlask";
  if (/Jewel/.test(t)) return "UniqueJewel";
  if (/Amulet|Ring|Belt/.test(t)) return "UniqueAccessory";
  if (/Shield|Quiver|Helmet|Gloves|Boots|Body Armour/.test(t)) return "UniqueArmour";
  if (t) return "UniqueWeapon";
  return undefined;
}

/** The poe.ninja line for a unique: same name (and base when given), the link group that matches (5L/6L priced apart). */
export function matchUnique(lines: NinjaLine[], item: Pick<OwnItem, "name" | "baseName" | "links">): NinjaLine | undefined {
  const name = item.name.split(",")[0].trim().toLowerCase();
  const same = lines.filter((l) => l.name.toLowerCase() === name && (!item.baseName || !l.baseType || l.baseType === item.baseName));
  if (!same.length) return undefined;
  const links = (item.links ?? 0) >= 5 ? item.links : undefined;
  const byLinks = same.filter((l) => (links ? l.links === links : !l.links));
  const pool = byLinks.length ? byLinks : same.filter((l) => !l.links).length ? same.filter((l) => !l.links) : same;
  // Several variants (e.g. different rolls): the cheapest is the safe sale price.
  return pool.reduce((a, b) => (a.chaosValue <= b.chaosValue ? a : b));
}

/**
 * The poe.ninja line for a gem: same name, the closest level/quality not above
 * the gem's, uncorrupted. Price sanity: a gem is never worth more than a
 * strictly better version of itself (same or higher level and quality), so a
 * thin, wishful line is capped by the better one.
 */
export function matchGem(lines: NinjaLine[], gem: OwnGem): NinjaLine | undefined {
  const want = gem.name.toLowerCase();
  const same = lines.filter((l) => { const ln = l.name.toLowerCase(); return (ln === want || ln === `${want} support`) && !l.corrupted; });
  const fit = same.filter((l) => (l.gemLevel ?? 1) <= gem.level && (l.gemQuality ?? 0) <= gem.quality);
  if (!fit.length) return undefined;
  const hit = fit.reduce((a, b) => ((b.gemLevel ?? 1) * 100 + (b.gemQuality ?? 0) > (a.gemLevel ?? 1) * 100 + (a.gemQuality ?? 0) ? b : a));
  const better = same.filter((l) => l !== hit && (l.gemLevel ?? 1) >= (hit.gemLevel ?? 1) && (l.gemQuality ?? 0) >= (hit.gemQuality ?? 0) && (l.listingCount ?? 0) >= 10);
  const cap = better.reduce((m, l) => Math.min(m, l.chaosValue), Infinity);
  return cap < hit.chaosValue ? { ...hit, chaosValue: cap, variant: `${hit.variant ?? ""} capped by a better version`.trim() } : hit;
}

/**
 * Prices the build's items and gems. `minChaos` hides gems worth less (most
 * gems are worth about 1c). Failures to reach poe.ninja end up in `notes`.
 */
export async function priceOwn(league: string, own: { items: OwnItem[]; gems: OwnGem[] }, opts: { minChaos?: number; fetchLines?: (type: string) => Promise<NinjaLine[]> } = {}): Promise<{ priced: Priced[]; notes: string[] }> {
  const fetchLines = opts.fetchLines ?? ((type: string) => ninjaItemLines(league, type));
  const minChaos = opts.minChaos ?? 5;
  const notes: string[] = [];
  const linesOf = new Map<string, NinjaLine[] | null>();
  const get = async (type: string) => {
    if (!linesOf.has(type)) {
      try { linesOf.set(type, await fetchLines(type)); } catch (e) {
        linesOf.set(type, null);
        notes.push(`poe.ninja ${type} prices unavailable (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    return linesOf.get(type);
  };
  const priced: Priced[] = [];
  for (const item of own.items) {
    const spare = !item.slot && !item.otherSet;
    if (item.rarity === "UNIQUE" || item.rarity === "RELIC") {
      const type = ninjaType(item);
      const lines = type ? await get(type) : undefined;
      const hit = lines ? matchUnique(lines, item) : undefined;
      priced.push(hit
        ? { kind: "item", id: item.id, name: item.name, slot: item.slot, chaos: hit.chaosValue, spare,
          basis: `poe.ninja${hit.links ? ` ${hit.links}L` : ""}${hit.variant ? ` (${hit.variant})` : ""}${(hit.listingCount ?? 99) < 10 ? `, only ${hit.listingCount} listed: uncertain` : ""}${item.corrupted ? "; corrupted, the price depends on the corruption" : ""}` }
        : { kind: "item", id: item.id, name: item.name, slot: item.slot, spare, basis: lines === null ? "prices unavailable" : "not on poe.ninja (rare variant or too few listings)" });
    } else if (item.rarity === "RARE") {
      priced.push({ kind: "item", id: item.id, name: `${item.name}${item.baseName ? `, ${item.baseName}` : ""}`, slot: item.slot, spare,
        basis: "rare: no automatic price; compare with trade_search (similar mods) or price it in game" });
    }
  }
  const gemLines = own.gems.length ? await get("SkillGem") : undefined;
  if (gemLines) {
    const seen = new Set<string>();
    for (const g of own.gems) {
      const hit = matchGem(gemLines, g);
      if (!hit || hit.chaosValue < minChaos) continue;
      const key = `${g.name}|${g.level}|${g.quality}|${g.group}`;
      if (seen.has(key)) continue;
      seen.add(key);
      priced.push({ kind: "gem", name: `${g.name} ${g.level}/${g.quality}`, slot: g.slot, chaos: hit.chaosValue, spare: g.enabled === false,
        basis: `poe.ninja ${hit.gemLevel ?? 1}/${hit.gemQuality ?? 0}${/capped/.test(hit.variant ?? "") ? ", capped by the price of a better version" : ""}${(hit.listingCount ?? 99) < 10 ? `, only ${hit.listingCount} listed: uncertain` : ""}` });
    }
  }
  priced.sort((a, b) => Number(b.spare) - Number(a.spare) || (b.chaos ?? -1) - (a.chaos ?? -1));
  return { priced, notes };
}
