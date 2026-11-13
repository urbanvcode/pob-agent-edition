/**
 * Crafting odds (Stage 6), from PoB's spawn weights.
 *
 * Rules used (cited in facts.ts): a random mod is picked with a chance in
 * proportion to its spawn weight among the mods that can still roll; only one
 * mod per mod group; mods above the item level cannot roll; magic items hold
 * 1 prefix + 1 suffix, rares 3 + 3. Rares roll 4, 5 or 6 mods at 8:3:1.
 * Rolls are simulated with a seeded random generator, so results repeat.
 */
import type { Want } from "./target.js";

export type Hits = Array<Array<{ want: number; alt: number; share: number }>>;
export interface OddsMod { type: "Prefix" | "Suffix"; group: string; weight: number }
export interface BenchOption { want: number; alt: number; type: "Prefix" | "Suffix"; share: number }

/** mulberry32: small, fast, seeded. */
export function rng(seed = 0x5eed): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const unitsOf = (wants: Want[]) => wants.reduce((s, w) => s + w.count, 0);

/** Units covered by the mods' realised hits: per want, distinct alternatives up to its count. */
export function covered(got: Array<{ want: number; alt: number }>, wants: Want[]): { units: number; per: Array<Set<number>> } {
  const per = wants.map(() => new Set<number>());
  for (const g of got) per[g.want].add(g.alt);
  return { units: per.reduce((s, set, i) => s + Math.min(set.size, wants[i].count), 0), per };
}

/** One roll's hits, each partial share realised once. */
function realise(hits: Hits[number], rand: () => number) {
  return hits.filter((h) => h.share >= 1 || rand() < h.share);
}

/** Bench can add the one missing unit: an option for a missing alternative, of a type with an open slot. */
function benchFills(per: Array<Set<number>>, wants: Want[], bench: BenchOption[], open: { Prefix: number; Suffix: number }): boolean {
  return bench.some((b) => open[b.type] > 0 && !per[b.want].has(b.alt) && per[b.want].size < wants[b.want].count && b.share >= 0.5);
}

export interface RareOdds { p: number; pBench: number; trials: number }

/**
 * Rare roll (Chaos Orb, Essence): n random mods, after the guaranteed ones.
 * p = all wants rolled; pBench = all wants after one bench craft.
 */
export function rareOdds(mods: OddsMod[], hits: Hits, wants: Want[], o: {
  n: number; limit: number; trials?: number; seed?: number;
  guaranteed?: { type: "Prefix" | "Suffix"; group: string; hits: Array<{ want: number; alt: number; share: number }> };
  bench?: BenchOption[];
}): RareOdds {
  const rand = rng(o.seed ?? 1);
  const trials = o.trials ?? 6_000;
  const need = unitsOf(wants);
  let ok = 0, okBench = 0;
  const idx = mods.map((_, i) => i).filter((i) => mods[i].weight > 0);
  for (let t = 0; t < trials; t++) {
    const used = new Set<string>();
    const count = { Prefix: 0, Suffix: 0 };
    const got: Array<{ want: number; alt: number }> = [];
    let n = o.n;
    if (o.guaranteed) {
      used.add(o.guaranteed.type + o.guaranteed.group);
      count[o.guaranteed.type]++;
      got.push(...realise(o.guaranteed.hits, rand));
      n--;
    }
    for (let k = 0; k < n; k++) {
      let total = 0;
      for (const i of idx) { const m = mods[i]; if (!used.has(m.type + m.group) && count[m.type] < o.limit) total += m.weight; }
      if (total <= 0) break;
      let x = rand() * total, pick = -1;
      for (const i of idx) {
        const m = mods[i];
        if (used.has(m.type + m.group) || count[m.type] >= o.limit) continue;
        x -= m.weight;
        if (x <= 0) { pick = i; break; }
      }
      if (pick < 0) pick = idx[idx.length - 1];
      const m = mods[pick];
      used.add(m.type + m.group);
      count[m.type]++;
      got.push(...realise(hits[pick], rand));
    }
    const c = covered(got, wants);
    if (c.units >= need) { ok++; okBench++; }
    else if (c.units === need - 1 && o.bench?.length && benchFills(c.per, wants, o.bench, { Prefix: o.limit - count.Prefix, Suffix: o.limit - count.Suffix })) okBench++;
  }
  return { p: ok / trials, pBench: okBench / trials, trials };
}

/** Rares: 4, 5 or 6 mods at 8:3:1 (poewiki, Rarity; facts.ts rareCount). */
export const RARE_COUNTS: Array<[number, number]> = [[4, 8 / 12], [5, 3 / 12], [6, 1 / 12]];

export interface RareRange { p: number; low: number; high: number; pBench: number; lowBench: number; highBench: number }

/** The 8:3:1 mix, plus 4 mods only (low) and 6 mods only (high) as the range. */
export function rareMix(mods: OddsMod[], hits: Hits, wants: Want[], o: Omit<Parameters<typeof rareOdds>[3], "n">): RareRange {
  const by = new Map<number, RareOdds>();
  for (const [n] of RARE_COUNTS) by.set(n, rareOdds(mods, hits, wants, { ...o, n, seed: (o.seed ?? 1) + n }));
  const mix = (k: "p" | "pBench") => RARE_COUNTS.reduce((s, [n, w]) => s + by.get(n)![k] * w, 0);
  const lo = (k: "p" | "pBench") => Math.min(...RARE_COUNTS.map(([n]) => by.get(n)![k]));
  const hi = (k: "p" | "pBench") => Math.max(...RARE_COUNTS.map(([n]) => by.get(n)![k]));
  return { p: mix("p"), low: lo("p"), high: hi("p"), pBench: mix("pBench"), lowBench: lo("pBench"), highBench: hi("pBench") };
}

export interface AltOdds {
  /** Chance per Alteration (+ Augmentation) that the magic item has the goal. */
  p: number;
  /** After that: chance a Regal Orb adds one more wanted mod. */
  regal: number;
  goal: number;
}

/**
 * Orb of Alteration (+ Augmentation): the magic item ends with one prefix and
 * one suffix, each picked by weight among its own type. goal = units wanted
 * from the magic item (1 or 2). regal = average chance, over the successes,
 * that a Regal Orb's random mod (any type, groups not already on the item)
 * adds another unit.
 */
export function altOdds(mods: OddsMod[], hits: Hits, wants: Want[], goal: number, o: { samples?: number; seed?: number } = {}): AltOdds {
  const rand = rng(o.seed ?? 7);
  const pre = mods.map((m, i) => ({ m, i })).filter((x) => x.m.type === "Prefix" && x.m.weight > 0);
  const suf = mods.map((m, i) => ({ m, i })).filter((x) => x.m.type === "Suffix" && x.m.weight > 0);
  const cum = (list: typeof pre) => { let s = 0; return list.map((x) => (s += x.m.weight)); };
  const cp = cum(pre), cs = cum(suf);
  const draw = (list: typeof pre, c: number[]) => {
    if (!list.length) return undefined;
    const x = rand() * c[c.length - 1];
    let lo = 0, hi = c.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid] < x) lo = mid + 1; else hi = mid; }
    return list[lo];
  };
  const samples = o.samples ?? 40_000;
  let ok = 0, regalSum = 0;
  for (let s = 0; s < samples; s++) {
    const a = draw(pre, cp), b = draw(suf, cs);
    const got = [...(a ? realise(hits[a.i], rand) : []), ...(b ? realise(hits[b.i], rand) : [])];
    const c = covered(got, wants);
    if (c.units < goal) continue;
    ok++;
    // Regal: weight of mods that add a unit / all weight that can still roll.
    const blocked = new Set([a, b].filter(Boolean).map((x) => x!.m.type + x!.m.group));
    let total = 0, good = 0;
    mods.forEach((m, i) => {
      if (m.weight <= 0 || blocked.has(m.type + m.group)) return;
      total += m.weight;
      const add = hits[i].reduce((best, h) => (!c.per[h.want].has(h.alt) && c.per[h.want].size < wants[h.want].count ? Math.max(best, h.share) : best), 0);
      good += m.weight * add;
    });
    regalSum += total > 0 ? good / total : 0;
  }
  return { p: ok / samples, regal: ok ? regalSum / ok : 0, goal };
}

/** Tries needed for a q chance of success (stop-and-buy points). */
export const triesFor = (p: number, q: number) => (p >= 1 ? 1 : p <= 0 ? Infinity : Math.ceil(Math.log(1 - q) / Math.log(1 - p)));
