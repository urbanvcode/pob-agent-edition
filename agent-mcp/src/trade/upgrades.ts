// Ported from ianderse/pob-mcp (https://github.com/ianderse/pob-mcp, GPL-3.0), original file: src/handlers/upgradePlanHandler.ts.
// Licensed under the GNU General Public License v3.0; see LICENSE at the repository root.
/**
 * plan_upgrades: "what cheap items improve my build?"
 *
 * For each gear slot PoB builds its own weighted best-upgrade trade query
 * (TradeQueryGenerator); we add the budget, search instant-buyout listings,
 * fetch the top few, turn them into PoB items and simulate each one in the
 * build. Results are ranked by improvement per chaos. Ported from our pob-mcp
 * fork; trade traffic stays inside the per-question budget of the client.
 */
import type { Reply } from "../pob.js";
import type { TradeApiClient } from "./client.js";
import { priceInChaos, tradeItemToPoBText } from "./itemText.js";
import { getPoeSessionId } from "../profile.js";
import { currencyRates } from "./ninja.js";
import type { ItemListing, TradeQuery } from "./types.js";

/** Listings the buyer can secure with instant buyout. The only status we search. */
export const INSTANT_BUYOUT = "securable" as const;

export type TestStats = Record<string, number | undefined>;

export interface PobLink {
  kind: "live" | "headless";
  call(action: string, params?: Record<string, unknown>): Promise<Reply>;
}

export interface UpgradeArgs {
  league: string;
  budget_chaos?: number;
  focus?: "balanced" | "dps" | "defence";
  slots?: string[];
  per_slot?: number;
  max_results?: number;
}

export interface UpgradeCandidate {
  slot: string;
  name: string;
  rarity?: string;
  priceChaos: number;
  priceText: string;
  dpsPct: number;
  ehpPct: number;
  lifeDelta: number;
  resNotes: string[];
  warnings: string[];
  score: number;
  value: number;
  url: string;
  itemText: string;
  seller?: string;
}

export const DEFAULT_SLOTS = ["Helmet", "Body Armour", "Gloves", "Boots", "Belt", "Amulet", "Ring 1"];
const RES = [["FireResist", "Fire"], ["ColdResist", "Cold"], ["LightningResist", "Lightning"]] as const;

export function weightsFor(focus: string) {
  if (focus === "dps") return [{ label: "Full DPS", stat: "FullDPS", weightMult: 1.0 }];
  if (focus === "defence") return [{ label: "Effective Hit Pool", stat: "TotalEHP", weightMult: 1.0 }];
  return [{ label: "Full DPS", stat: "FullDPS", weightMult: 1.0 }, { label: "Effective Hit Pool", stat: "TotalEHP", weightMult: 0.5 }];
}

function dps(s: TestStats) {
  return (s.FullDPS && s.FullDPS > 0) ? s.FullDPS : (s.CombinedDPS ?? s.TotalDPS ?? 0);
}

function pct(a: number, b: number) {
  return b > 0 ? (a - b) / b * 100 : 0;
}

export function evaluateCandidate(base: TestStats, test: TestStats, focus: string) {
  const dpsPct = pct(dps(test), dps(base));
  const ehpPct = pct(test.TotalEHP ?? 0, base.TotalEHP ?? 0);
  const lifeDelta = (test.Life ?? 0) - (base.Life ?? 0);
  const resNotes: string[] = [];
  const warnings: string[] = [];
  let resPenalty = 0;
  for (const [key, label] of RES) {
    const b = base[key] ?? 0, t = test[key] ?? 0;
    if (t < 75 && t < b) { warnings.push(`${label} res drops to ${Math.round(t)}%`); resPenalty += (75 - t); }
    else if (b < 75 && t > b) resNotes.push(`${label} res ${Math.round(b)}% -> ${Math.round(t)}%`);
  }
  const cb = base.ChaosResist ?? 0, ct = test.ChaosResist ?? 0;
  if (Math.abs(ct - cb) >= 5) resNotes.push(`Chaos res ${Math.round(cb)}% -> ${Math.round(ct)}%`);
  for (const [attr, req] of [["Str", "ReqStr"], ["Dex", "ReqDex"], ["Int", "ReqInt"]]) {
    const shortNow = (test[req] ?? 0) - (test[attr] ?? 0), shortBefore = (base[req] ?? 0) - (base[attr] ?? 0);
    // Only the item's own doing: a requirement that was already unmet and did not get worse is not its fault.
    if (shortNow > 0 && shortNow > Math.max(shortBefore, 0)) warnings.push(`${attr} requirement not met (${Math.round(test[attr] ?? 0)}/${Math.round(test[req] ?? 0)})`);
  }
  if ((test.ManaUnreserved ?? 0) < 0 && (base.ManaUnreserved ?? 0) >= 0) warnings.push("mana becomes over-reserved");
  const w = focus === "dps" ? [1, 0.15] : focus === "defence" ? [0.15, 1] : [1, 0.6];
  let score = dpsPct * w[0] + ehpPct * w[1] + resNotes.length * 2 - resPenalty * 0.5 - (warnings.length > 0 ? 10 : 0);
  if (!Number.isFinite(score)) score = 0;
  return { dpsPct, ehpPct, lifeDelta, resNotes, warnings, score };
}

export function tradeUrl(league: string, searchId: string, itemId?: string) {
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${searchId}${itemId ? `#${itemId}` : ""}`;
}

export async function ratesOrChaosOnly(league: string, notes: string[]): Promise<Map<string, number>> {
  try {
    return await currencyRates(league);
  } catch {
    notes.push("Could not load currency rates from poe.ninja; only chaos-priced listings are compared.");
    return new Map([["Chaos Orb", 1]]);
  }
}

/** One listing from a slot search, priced and simulated in the build. */
export interface SlotEntry {
  listing: ItemListing;
  chaos: number;
  text: string;
  stats: TestStats;
  rarity?: string;
  ev: ReturnType<typeof evaluateCandidate>;
}

export interface SlotResult {
  slot: string;
  searchId: string;
  base: TestStats;
  current?: { name?: string; baseName?: string; rarity?: string };
  entries: SlotEntry[];
}

export const LOGGED_OUT_NOTE = "Trade site not logged in (no POESESSID in Options), so PoB's weighted search is refused: each slot was searched for at least 2 of the stats worth most to the build, cheapest first, and every listing simulated in PoB.";

/** Stats in a logged-out "count" search (the site refuses weighted searches without a login). */
export const COUNT_FILTERS = 8;

/** Rares of the category with at least two of the given stats (one when fewer than four), cheapest first. */
export function countQuery(category: string, ids: string[], maxPrice: number): TradeQuery {
  return {
    query: {
      status: { option: INSTANT_BUYOUT },
      stats: [{ type: "count", value: { min: ids.length >= 4 ? 2 : 1 }, filters: ids.map((id) => ({ id })) }],
      filters: { type_filters: { filters: { category: { option: category }, rarity: { option: "nonunique" } } }, trade_filters: { filters: { price: { max: maxPrice } } } },
    },
    sort: { price: "asc" },
  };
}

/** Budget or rate-limit stops end the whole plan; other errors skip the slot. */
export const isStop = (msg: string) => /Stopped after|asks for a pause|slow down/i.test(msg);

/**
 * One slot: PoB's weighted best-upgrade query, limited to instant buyout and
 * maxPrice, the top `perSlot` listings fetched and each simulated in the slot.
 * Returns a note string instead when the slot gives nothing.
 */
export async function searchSlot(lua: PobLink, trade: TradeApiClient, league: string, slot: string,
  o: { focus: string; maxPrice: number; perSlot: number; rates: Map<string, number>; notes?: string[] }): Promise<SlotResult | string> {
  const loggedIn = !!getPoeSessionId();
  let q: TradeQuery | undefined;
  if (loggedIn) {
    const { query } = await lua.call("generate_weighted_trade_query", { slot, options: { statWeights: weightsFor(o.focus) } });
    q = (typeof query === "string" ? JSON.parse(query) : query) as TradeQuery;
    if (!q?.query) return `${slot}: PoB produced no query`;
    q.query.status = { option: INSTANT_BUYOUT };
    const filters = (q.query.filters ??= {});
    filters.trade_filters = { filters: { ...(filters.trade_filters?.filters ?? {}), price: { max: o.maxPrice } } };
  }
  let search;
  try {
    search = q ? await trade.searchItems(league, q) : undefined;
  } catch (error) {
    // Logged-in limits are higher, but a long query can still be refused: fall back like a logged-out search.
    if (!/too complex/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }
  if (!search) {
    // Logged out, the trade site refuses every weighted search ("Query is too complex"), so ask for
    // listings with at least two of the stats a top roll is worth most for, cheapest first; PoB then
    // simulates each one exactly as for a weighted search.
    const [t] = (await lua.call("economy_targets", { slots: [slot], focus: o.focus, top: COUNT_FILTERS })).result as Array<{ stats?: Array<{ id: string }>; category?: string; error?: string }>;
    if (!t?.stats?.length || !t.category) return `${slot}: ${t?.error ?? "PoB found no stat that beats the current item"}`;
    q = countQuery(t.category, t.stats.map((x) => x.id), o.maxPrice);
    search = await trade.searchItems(league, q);
    if (o.notes && !o.notes.includes(LOGGED_OUT_NOTE)) o.notes.push(LOGGED_OUT_NOTE);
  }
  if (!search.result?.length) return `${slot}: nothing under ${Math.round(o.maxPrice)}c`;
  const listings = await trade.fetchItems(search.result.slice(0, o.perSlot), search.id);
  const usable = listings
    .map((l) => ({ l, chaos: priceInChaos(l.listing.price, o.rates) }))
    .filter((x): x is { l: ItemListing; chaos: number } => x.chaos !== undefined && x.chaos <= o.maxPrice * 1.001);
  if (!usable.length) return `${slot}: no listings with a known price under ${Math.round(o.maxPrice)}c`;
  const texts = usable.map((x) => tradeItemToPoBText(x.l.item));
  let report;
  try {
    report = (await lua.call("test_items", { slot, items: texts })).result;
  } catch (error) {
    return `${slot}: PoB could not test items (${error instanceof Error ? error.message : String(error)})`;
  }
  const entries: SlotEntry[] = [];
  (report.results as Array<{ ok: boolean; stats?: TestStats; rarity?: string }>).forEach((r, i) => {
    if (!r.ok || !r.stats) return;
    entries.push({ listing: usable[i].l, chaos: usable[i].chaos, text: texts[i], stats: r.stats, rarity: r.rarity, ev: evaluateCandidate(report.base, r.stats, o.focus) });
  });
  return { slot, searchId: search.id, base: report.base, current: report.current, entries };
}

/** Not an upgrade: overall score too low, or a big loss on the focused stat. */
export function isUpgrade(ev: ReturnType<typeof evaluateCandidate>, focus: string): boolean {
  if (ev.score <= 0.5) return false;
  if (focus !== "defence" && ev.dpsPct < -5) return false;
  if (focus !== "dps" && ev.ehpPct < -5) return false;
  return true;
}

export function toCandidate(league: string, r: SlotResult, e: SlotEntry): UpgradeCandidate {
  const price = e.listing.listing.price!;
  return {
    slot: r.slot,
    name: [e.listing.item.name, e.listing.item.typeLine].filter(Boolean).join(", "),
    rarity: e.rarity,
    priceChaos: e.chaos,
    priceText: `${price.amount} ${price.currency}`,
    ...e.ev,
    value: e.ev.score / Math.max(e.chaos, 1),
    url: tradeUrl(league, r.searchId, e.listing.id),
    itemText: e.text,
    seller: e.listing.listing.account?.name,
  };
}

export async function planUpgrades(lua: PobLink, trade: TradeApiClient, args: UpgradeArgs): Promise<{ candidates: UpgradeCandidate[]; notes: string[] }> {
  const budget = Math.max(1, args.budget_chaos ?? 50);
  const focus = args.focus ?? "balanced";
  const slots = (args.slots && args.slots.length ? args.slots : DEFAULT_SLOTS).slice(0, 8);
  const perSlot = Math.min(Math.max(args.per_slot ?? 4, 1), 8);
  const notes: string[] = [];
  const rates = await ratesOrChaosOnly(args.league, notes);

  const candidates: UpgradeCandidate[] = [];
  for (const slot of slots) {
    let r: SlotResult | string;
    try {
      r = await searchSlot(lua, trade, args.league, slot, { focus, maxPrice: budget, perSlot, rates, notes });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      notes.push(`${slot}: ${msg}`);
      if (isStop(msg)) break;
      continue;
    }
    if (typeof r === "string") { notes.push(r); continue; }
    for (const e of r.entries) if (isUpgrade(e.ev, focus)) candidates.push(toCandidate(args.league, r, e));
  }

  candidates.sort((a, b) => b.value - a.value || b.score - a.score);
  return { candidates: candidates.slice(0, Math.max(1, args.max_results ?? 8)), notes };
}

// --- resist fixing ----------------------------------------------------------------
const RESIST_STATS: Record<string, string> = {
  Fire: "pseudo.pseudo_total_fire_resistance", Cold: "pseudo.pseudo_total_cold_resistance",
  Lightning: "pseudo.pseudo_total_lightning_resistance", Chaos: "pseudo.pseudo_total_chaos_resistance",
};
const SLOT_CATEGORY: Record<string, string> = {
  "Ring 1": "accessory.ring", "Ring 2": "accessory.ring", "Amulet": "accessory.amulet", "Belt": "accessory.belt",
  "Helmet": "armour.helmet", "Gloves": "armour.gloves", "Boots": "armour.boots", "Body Armour": "armour.chest",
};
const RESIST_SLOTS = ["Ring 1", "Ring 2", "Belt", "Boots", "Gloves", "Helmet", "Amulet"];

export type Missing = Record<"Fire" | "Cold" | "Lightning" | "Chaos", number>;

export function missingResists(stats: TestStats, includeChaos: boolean): Missing {
  const m = (k: string) => Math.max(0, Math.round(stats[k] ?? 0));
  return { Fire: m("MissingFireResist"), Cold: m("MissingColdResist"), Lightning: m("MissingLightningResist"), Chaos: includeChaos ? m("MissingChaosResist") : 0 };
}

const total = (m: Missing) => m.Fire + m.Cold + m.Lightning + m.Chaos;

/** The trade query for one slot: items whose missing resistances add up to at least `min`, cheapest first. */
export function resistQuery(category: string, missing: Missing, budget: number, loggedIn = true): TradeQuery {
  if (!loggedIn) {
    // Weighted searches need a login; without one: any of the missing resistances with a useful roll.
    const keys = (Object.keys(RESIST_STATS) as Array<keyof Missing>).filter((k) => missing[k] > 0);
    return {
      query: {
        status: { option: INSTANT_BUYOUT },
        stats: [{ type: "count", value: { min: 1 }, filters: keys.map((k) => ({ id: RESIST_STATS[k], value: { min: Math.min(missing[k], 20) } })) }],
        filters: { type_filters: { filters: { category: { option: category } } }, trade_filters: { filters: { price: { max: budget } } } },
      },
      sort: { price: "asc" },
    };
  }
  const filters = (Object.keys(RESIST_STATS) as Array<keyof Missing>).filter((k) => missing[k] > 0).map((k) => ({ id: RESIST_STATS[k], value: { weight: 1 } }));
  // One item rarely carries more than about 90% of resistances: ask for a useful share of what is missing.
  const min = Math.max(12, Math.min(total(missing), 45));
  return {
    query: {
      status: { option: INSTANT_BUYOUT },
      stats: [{ type: "weight", filters, value: { min } }],
      filters: { type_filters: { filters: { category: { option: category } } }, trade_filters: { filters: { price: { max: budget } } } },
    },
    sort: { price: "asc" },
  };
}

/**
 * Cheap gear that caps the resistances that are short. Each listing is put in
 * the build by PoB, so what the replaced item gave is taken off first: the
 * score is how many missing resistance points are really fixed.
 */
export async function planResistFix(lua: PobLink, trade: TradeApiClient, args: UpgradeArgs): Promise<{ candidates: UpgradeCandidate[]; notes: string[]; missing: Missing }> {
  const budget = Math.max(1, args.budget_chaos ?? 50);
  const notes: string[] = [];
  const now = (await lua.call("key_stats", { fields: ["MissingFireResist", "MissingColdResist", "MissingLightningResist", "MissingChaosResist"] })).stats as TestStats;
  // Elemental resistances come first; chaos is only chased once they are capped.
  const elemental = missingResists(now, false);
  const withChaos = total(elemental) === 0;
  const missing = missingResists(now, withChaos);
  const chaosShort = Math.max(0, Math.round(now.MissingChaosResist ?? 0));
  if (!withChaos && chaosShort > 0) notes.push(`Chaos resistance is also ${chaosShort}% short; it is left for after the elemental resistances are capped.`);
  if (total(missing) === 0) return { candidates: [], notes, missing };
  const slots = (args.slots && args.slots.length ? args.slots : RESIST_SLOTS).filter((s) => {
    if (SLOT_CATEGORY[s]) return true;
    notes.push(`${s}: not searched for resistances (use rings, amulet, belt or armour slots)`);
    return false;
  }).slice(0, 7);
  const perSlot = Math.min(Math.max(args.per_slot ?? 4, 1), 8);
  const rates = await ratesOrChaosOnly(args.league, notes);
  const candidates: UpgradeCandidate[] = [];
  for (const slot of slots) {
    let searchId: string;
    let listings;
    try {
      const search = await trade.searchItems(args.league, resistQuery(SLOT_CATEGORY[slot], missing, budget, !!getPoeSessionId()));
      searchId = search.id;
      if (!search.result?.length) { notes.push(`${slot}: nothing under ${budget}c with enough of the missing resistances`); continue; }
      listings = await trade.fetchItems(search.result.slice(0, perSlot), search.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      notes.push(`${slot}: ${msg}`);
      if (/Stopped after|asks for a pause|slow down/i.test(msg)) break;
      continue;
    }
    const usable = listings.map((l) => ({ l, chaos: priceInChaos(l.listing.price, rates) })).filter((x) => x.chaos !== undefined && x.chaos <= budget * 1.001);
    if (!usable.length) { notes.push(`${slot}: no listings with a known price under ${budget}c`); continue; }
    const texts = usable.map((x) => tradeItemToPoBText(x.l.item));
    let report;
    try {
      report = (await lua.call("test_items", { slot, items: texts })).result;
    } catch (error) {
      notes.push(`${slot}: PoB could not test items (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const before = total(missingResists(report.base, withChaos));
    (report.results as Array<{ ok: boolean; stats?: TestStats; rarity?: string }>).forEach((r, i) => {
      if (!r.ok || !r.stats) return;
      const fixed = before - total(missingResists(r.stats, withChaos));
      if (fixed <= 0) return;
      const { l, chaos } = usable[i];
      const ev = evaluateCandidate(report.base, r.stats, "balanced");
      const price = l.listing.price!;
      const left = missingResists(r.stats, withChaos);
      const leftText = total(left) === 0 ? "all capped" : `still missing ${(Object.keys(left) as Array<keyof Missing>).filter((k) => left[k] > 0).map((k) => `${k} ${left[k]}%`).join(", ")}`;
      candidates.push({
        slot,
        name: [l.item.name, l.item.typeLine].filter(Boolean).join(", "),
        rarity: r.rarity,
        priceChaos: chaos!,
        priceText: `${price.amount} ${price.currency}`,
        ...ev,
        resNotes: [`fixes ${fixed} of ${before} missing resistance (${leftText})`],
        warnings: ev.warnings.filter((w) => !/ res drops to /.test(w)),
        score: fixed,
        value: fixed / Math.max(chaos!, 1),
        url: tradeUrl(args.league, searchId, l.id),
        itemText: texts[i],
        seller: l.listing.account?.name,
      });
    });
  }
  // Most resistance fixed first; the cheaper one wins a tie.
  candidates.sort((a, b) => b.score - a.score || a.priceChaos - b.priceChaos);
  return { candidates: candidates.slice(0, Math.max(1, args.max_results ?? 8)), notes, missing };
}

export function formatPlan(league: string, budget: number, result: { candidates: UpgradeCandidate[]; notes: string[] }): string {
  const lines = [`Upgrade plan: ${league}, up to ${budget}c per item, instant buyout only`, ""];
  if (!result.candidates.length) lines.push("No upgrades found within the budget for the searched slots.");
  result.candidates.forEach((c, i) => {
    const parts = [`DPS ${c.dpsPct >= 0 ? "+" : ""}${c.dpsPct.toFixed(1)}%`, `EHP ${c.ehpPct >= 0 ? "+" : ""}${c.ehpPct.toFixed(1)}%`];
    if (Math.abs(c.lifeDelta) >= 1) parts.push(`Life ${c.lifeDelta > 0 ? "+" : ""}${Math.round(c.lifeDelta)}`);
    lines.push(`${i + 1}. [${c.slot}] ${c.name} - ${c.priceText} (~${c.priceChaos >= 1 ? Math.round(c.priceChaos) : c.priceChaos.toFixed(2)}c)`);
    lines.push(`   ${parts.join(" | ")}${c.resNotes.length ? " | " + c.resNotes.join(", ") : ""}`);
    if (c.warnings.length) lines.push(`   Warning: ${c.warnings.join("; ")}`);
    lines.push(`   ${c.url}`);
  });
  if (result.notes.length) { lines.push("", "Notes:"); for (const note of result.notes) lines.push(`- ${note}`); }
  return lines.join("\n");
}
