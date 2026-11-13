/**
 * Price sanity (Stage 5). Trade prices are noisy: a few listings far below the
 * rest are bait or price-fixing (and often gone or not what they look like),
 * a few far above are wishful, and listings that have sat for weeks are not
 * selling at their price. A "fair price" is the median of the listings left
 * after those are set aside; every number says what was set aside.
 */
import { n } from "../format.js";

const DAY = 86_400_000;

export interface PricePoint { chaos: number; indexed?: string }

export interface FairPrice {
  /** Median of the listings kept, in chaos. */
  fair: number;
  /** Cheapest kept listing. */
  low: number;
  kept: number;
  droppedLow: number;
  droppedHigh: number;
  droppedOld: number;
  /** One line for the player: what the number rests on. */
  note: string;
  /** True when too few listings remain to trust the number. */
  thin: boolean;
}

export function ageDays(indexed: string | undefined, now = Date.now()): number | undefined {
  if (!indexed) return undefined;
  const t = Date.parse(indexed);
  return Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : undefined;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Fair price from listings (cheapest first or any order). Steps: prefer
 * listings newer than `maxAgeDays` when at least 3 are; then drop prices
 * under 50% or over 300% of the median and take the median of the rest.
 */
export function fairPrice(points: PricePoint[], opts: { maxAgeDays?: number; now?: number } = {}): FairPrice | undefined {
  const all = points.filter((p) => Number.isFinite(p.chaos) && p.chaos > 0);
  if (!all.length) return undefined;
  const maxAge = opts.maxAgeDays ?? 14;
  const fresh = all.filter((p) => (ageDays(p.indexed, opts.now) ?? 0) <= maxAge);
  const pool = fresh.length >= 3 ? fresh : all;
  const droppedOld = all.length - pool.length;
  const m0 = median(pool.map((p) => p.chaos));
  const kept = pool.filter((p) => p.chaos >= m0 * 0.5 && p.chaos <= m0 * 3);
  const droppedLow = pool.filter((p) => p.chaos < m0 * 0.5).length;
  const droppedHigh = pool.filter((p) => p.chaos > m0 * 3).length;
  const prices = (kept.length ? kept : pool).map((p) => p.chaos);
  const fair = median(prices);
  const low = Math.min(...prices);
  const set: string[] = [];
  if (droppedLow) set.push(`${droppedLow} far below the rest (likely bait or price-fixing)`);
  if (droppedHigh) set.push(`${droppedHigh} far above`);
  if (droppedOld) set.push(`${droppedOld} listed more than ${maxAge} days ago`);
  const thin = prices.length < 3;
  const note = `median of ${prices.length} listing(s)${set.length ? `; set aside: ${set.join(", ")}` : ""}${thin ? "; few listings, so the price is uncertain" : ""}`;
  return { fair, low, kept: prices.length, droppedLow, droppedHigh, droppedOld, note, thin };
}

/**
 * Warnings for one listing the planner wants to buy. `peers` are prices of
 * the same item (same unique name) seen in the same search.
 */
export function buyWarnings(price: number, indexed: string | undefined, peers: number[], now = Date.now()): string[] {
  const out: string[] = [];
  if (peers.length >= 3) {
    const m = median(peers);
    if (price < m * 0.5) out.push(`priced far below other listings of this item (median ${n(m)}c): check the mods, links and corruption before buying`);
  }
  const age = ageDays(indexed, now);
  if (age !== undefined && age > 30) out.push(`listed ${Math.floor(age)} days ago`);
  return out;
}
