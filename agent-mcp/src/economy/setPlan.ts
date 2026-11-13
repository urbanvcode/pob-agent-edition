/**
 * Total-budget planner (Stage 5): "I have 3 div, what should I buy?"
 *
 * plan_upgrades ranks single items; this picks the best SET of purchases
 * across slots for one total budget:
 * 1. each slot is searched once with PoB's weighted upgrade query (instant
 *    buyout, price <= the whole budget), the listings simulated one by one;
 * 2. a knapsack (one item per slot) picks the set with the highest summed gain
 *    that fits the budget;
 * 3. that set is simulated TOGETHER in PoB (what_if, rolled back), because
 *    gains overlap (diminishing returns) and one item can break what another
 *    needs: resistances that drop under the cap or attribute requirements that
 *    are no longer met make a set invalid, and it is repaired by dropping or
 *    swapping items, each repair simulated again;
 * 4. a few swaps are tried to improve the combined gain;
 * 5. better items that did not fit become "save for" targets.
 * Trade traffic stays inside the client's per-question budget (two requests
 * per slot) and its pacing; the player buys by opening each link.
 */
import { evaluateCandidate, isStop, isUpgrade, ratesOrChaosOnly, searchSlot, toCandidate, DEFAULT_SLOTS,
  type PobLink, type SlotResult, type TestStats, type UpgradeCandidate } from "../trade/upgrades.js";
import type { TradeApiClient } from "../trade/client.js";
import { buyWarnings } from "./sanity.js";

export interface SetArgs {
  league: string;
  budgetChaos: number;
  focus?: "balanced" | "dps" | "defence";
  slots?: string[];
  perSlot?: number;
  /** Hardcore: a set that lowers EHP is not accepted. */
  noDefenceLoss?: boolean;
  /** Most combined simulations to run (each is one PoB recalculation). */
  maxSims?: number;
}

export interface PlanItem extends UpgradeCandidate { listingId: string; sanity: string[] }

export interface Combined { dpsPct: number; ehpPct: number; lifeDelta: number; resNotes: string[]; warnings: string[]; score: number }

export interface SetPlan {
  league: string;
  budget: number;
  focus: string;
  buy: PlanItem[];
  spent: number;
  left: number;
  combined?: Combined;
  /** What the same items add up to one by one (shows the overlap). */
  singles: { dpsPct: number; ehpPct: number };
  saveFor: Array<PlanItem & { more: number }>;
  searched: string[];
  notes: string[];
  sims: number;
}

const EV_FIELDS = ["MissingFireResist", "MissingColdResist", "MissingLightningResist", "MissingChaosResist"];

/** One item per slot, highest summed score within the budget (prices rounded to budget/400). */
export function knapsack<T extends { slot: string; priceChaos: number; score: number; listingId?: string }>(groups: T[][], budget: number): T[] {
  const unit = Math.max(1, budget / 400);
  const cap = Math.floor(budget / unit + 1e-9);
  // best[c] = { score, picks } using capacity c
  let best: Array<{ score: number; picks: T[] }> = Array.from({ length: cap + 1 }, () => ({ score: 0, picks: [] }));
  for (const group of groups) {
    const next = best.map((b) => ({ score: b.score, picks: b.picks }));
    for (const item of group) {
      const w = Math.ceil(item.priceChaos / unit - 1e-9);
      if (w > cap || item.score <= 0) continue;
      for (let c = cap; c >= w; c--) {
        const from = best[c - w];
        if (item.listingId && from.picks.some((p) => p.listingId === item.listingId)) continue;
        const s = from.score + item.score;
        if (s > next[c].score + 1e-9) next[c] = { score: s, picks: [...from.picks, item] };
      }
    }
    best = next;
  }
  return best.reduce((a, b) => (b.score > a.score + 1e-9 || (Math.abs(b.score - a.score) <= 1e-9 && sum(b.picks) < sum(a.picks)) ? b : a)).picks;
}

const sum = (xs: Array<{ priceChaos: number }>) => xs.reduce((s, x) => s + x.priceChaos, 0);

/** Problems that make a combined set invalid. */
export function problems(c: Combined, noDefenceLoss: boolean): string[] {
  const out = [...c.warnings];
  if (noDefenceLoss && c.ehpPct < -0.5) out.push(`EHP drops ${c.ehpPct.toFixed(1)}% (hardcore: defence first)`);
  return out;
}

export async function planBudget(lua: PobLink, trade: TradeApiClient, args: SetArgs): Promise<SetPlan> {
  const budget = Math.max(1, args.budgetChaos);
  const focus = args.focus ?? "balanced";
  const slots = (args.slots && args.slots.length ? args.slots : DEFAULT_SLOTS).slice(0, 7);
  const perSlot = Math.min(Math.max(args.perSlot ?? 10, 1), 10);
  const maxSims = Math.max(1, args.maxSims ?? 30);
  const notes: string[] = [];
  const rates = await ratesOrChaosOnly(args.league, notes);

  // 1. search and simulate each slot on its own
  const groups: PlanItem[][] = [];
  const searched: string[] = [];
  for (const slot of slots) {
    let r: SlotResult | string;
    try {
      r = await searchSlot(lua, trade, args.league, slot, { focus, maxPrice: budget, perSlot, rates });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      notes.push(`${slot}: ${msg}`);
      if (isStop(msg)) break;
      continue;
    }
    searched.push(slot);
    if (typeof r === "string") { notes.push(r); continue; }
    const res = r;
    // Peers for the price check: other listings of the same unique in this search.
    const peersOf = (e: SlotResult["entries"][number]) => e.rarity !== "UNIQUE" ? []
      : res.entries.filter((x) => x !== e && x.rarity === "UNIQUE" && x.listing.item.name === e.listing.item.name).map((x) => x.chaos);
    const group = res.entries.filter((e) => isUpgrade(e.ev, focus))
      .map((e) => ({ ...toCandidate(args.league, res, e), listingId: e.listing.id, sanity: buyWarnings(e.chaos, e.listing.listing.indexed, peersOf(e)) }));
    if (!group.length) notes.push(`${slot}: no listing under ${Math.round(budget)}c beats the current item`);
    groups.push(group);
  }

  // 2.-4. knapsack, then simulate together, repair and improve
  let sims = 0;
  const cache = new Map<string, Combined | undefined>();
  const keyOf = (set: PlanItem[]) => set.map((p) => p.listingId).sort().join("|");
  const simulate = async (set: PlanItem[]): Promise<Combined | undefined> => {
    if (!set.length) return undefined;
    const key = keyOf(set);
    if (cache.has(key)) return cache.get(key);
    if (sims >= maxSims) return undefined;
    sims++;
    let out: Combined | undefined;
    try {
      const r = await lua.call("what_if", { ops: set.map((p) => ({ op: "equip", slot: p.slot, text: p.itemText })), fields: EV_FIELDS });
      if (r.failed > 0) notes.push(`PoB could not equip part of a set: ${(r.results as Array<{ ok: boolean; error?: string }>).filter((x) => !x.ok).map((x) => x.error).join("; ")}`);
      if (r.rolledBack === false) notes.push(`Rollback check: ${r.rollbackProblem}`);
      const ev = evaluateCandidate(r.before as TestStats, r.after as TestStats, focus);
      out = { dpsPct: ev.dpsPct, ehpPct: ev.ehpPct, lifeDelta: ev.lifeDelta, resNotes: ev.resNotes, warnings: ev.warnings, score: ev.score };
    } catch (error) {
      notes.push(`Combined simulation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    cache.set(key, out);
    return out;
  };
  const noLoss = args.noDefenceLoss === true;
  const valid = (c: Combined | undefined) => !!c && problems(c, noLoss).length === 0;

  let set = knapsack(groups, budget);
  let combined = await simulate(set);

  // Repair: drop or swap items until the set keeps resistances, attributes and mana (and EHP on hardcore).
  for (let round = 0; set.length && !valid(combined) && round < 4 && sims < maxSims; round++) {
    const options: PlanItem[][] = [];
    for (const p of set) {
      const rest = set.filter((x) => x !== p);
      options.push(rest);
      const alts = (groups.find((g) => g.includes(p)) ?? []).filter((a) => a !== p && a.warnings.length === 0 && sum(rest) + a.priceChaos <= budget)
        .sort((a, b) => b.score - a.score).slice(0, 1);
      for (const a of alts) options.push([...rest, a]);
    }
    let bestSet: PlanItem[] | undefined, best: Combined | undefined;
    for (const o of options) {
      const c = await simulate(o);
      if (c && valid(c) && (!best || c.score > best.score)) { bestSet = o; best = c; }
    }
    if (!bestSet) {
      // Nothing valid one step away: drop the item with the most warnings of its own and try again.
      const worst = [...set].sort((a, b) => b.warnings.length - a.warnings.length || a.score - b.score)[0];
      set = set.filter((x) => x !== worst);
      combined = await simulate(set);
    } else { set = bestSet; combined = best; }
  }
  if (set.length && !valid(combined)) {
    notes.push(combined ? `No valid set found within ${sims} simulations; the plan below still has: ${problems(combined, noLoss).join("; ")}` : "The combined simulation did not run; the set is ranked on single-item numbers only.");
  }

  // Improve: try swapping in the next-best item of each slot (or adding a slot) while it fits.
  if (combined && valid(combined)) {
    for (const g of groups) {
      if (sims >= maxSims) break;
      const mine = set.find((p) => g.includes(p));
      const alts = g.filter((a) => a !== mine).sort((a, b) => b.score - a.score).slice(0, 2);
      for (const a of alts) {
        const trial = [...set.filter((x) => x !== mine), a];
        if (sum(trial) > budget) continue;
        const c = await simulate(trial);
        if (c && valid(c) && c.score > combined!.score + 0.25) { set = trial; combined = c; }
      }
    }
  }

  const spent = sum(set);
  const singles = { dpsPct: set.reduce((s, p) => s + p.dpsPct, 0), ehpPct: set.reduce((s, p) => s + p.ehpPct, 0) };

  // 5. save for: better than what the plan buys in that slot, but did not fit
  // "more" = what is missing to buy it instead of the plan's item in that slot.
  const saveFor = groups.map((g) => {
    const mine = set.find((p) => g.includes(p));
    const room = budget - spent + (mine?.priceChaos ?? 0);
    const best = g.filter((a) => a !== mine && a.score > (mine?.score ?? 0) * 1.25 && a.priceChaos > room && a.warnings.length === 0)
      .sort((a, b) => b.score - a.score)[0];
    return best ? { ...best, more: best.priceChaos - room } : undefined;
  }).filter((x): x is PlanItem & { more: number } => !!x).sort((a, b) => b.score - a.score).slice(0, 3);

  set.sort((a, b) => b.score - a.score);
  return { league: args.league, budget, focus, buy: set, spent, left: budget - spent, combined, singles, saveFor, searched, notes, sims };
}
