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
import { currencyRates } from "./ninja.js";
import type { TradeQuery } from "./types.js";

/** Listings the buyer can secure with instant buyout. The only status we search. */
export const INSTANT_BUYOUT = "securable" as const;

export type TestStats = Record<string, number | undefined>;

interface PobLink {
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

const DEFAULT_SLOTS = ["Helmet", "Body Armour", "Gloves", "Boots", "Belt", "Amulet", "Ring 1"];
const RES = [["FireResist", "Fire"], ["ColdResist", "Cold"], ["LightningResist", "Lightning"]] as const;

function weightsFor(focus: string) {
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
    if ((test[req] ?? 0) > (test[attr] ?? 0)) warnings.push(`${attr} requirement not met (${Math.round(test[attr] ?? 0)}/${Math.round(test[req] ?? 0)})`);
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

export async function planUpgrades(lua: PobLink, trade: TradeApiClient, args: UpgradeArgs): Promise<{ candidates: UpgradeCandidate[]; notes: string[] }> {
  const budget = Math.max(1, args.budget_chaos ?? 50);
  const focus = args.focus ?? "balanced";
  const slots = (args.slots && args.slots.length ? args.slots : DEFAULT_SLOTS).slice(0, 8);
  const perSlot = Math.min(Math.max(args.per_slot ?? 4, 1), 8);
  const notes: string[] = [];
  const rates = await ratesOrChaosOnly(args.league, notes);

  const candidates: UpgradeCandidate[] = [];
  for (const slot of slots) {
    let searchId: string;
    let listings;
    try {
      const { query } = await lua.call("generate_weighted_trade_query", { slot, options: { statWeights: weightsFor(focus) } });
      const q = (typeof query === "string" ? JSON.parse(query) : query) as TradeQuery;
      if (!q?.query) { notes.push(`${slot}: PoB produced no query`); continue; }
      q.query.status = { option: INSTANT_BUYOUT };
      const filters = (q.query.filters ??= {});
      filters.trade_filters = { filters: { ...(filters.trade_filters?.filters ?? {}), price: { max: budget } } };
      const search = await trade.searchItems(args.league, q);
      searchId = search.id;
      if (!search.result?.length) { notes.push(`${slot}: nothing under ${budget}c`); continue; }
      listings = await trade.fetchItems(search.result.slice(0, perSlot), search.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      notes.push(`${slot}: ${msg}`);
      // Budget or rate-limit stops end the whole plan; other errors skip the slot.
      if (/Stopped after|asks for a pause|slow down/i.test(msg)) break;
      continue;
    }

    const usable = listings
      .map((l) => ({ l, chaos: priceInChaos(l.listing.price, rates) }))
      .filter((x) => x.chaos !== undefined && x.chaos <= budget * 1.001);
    if (!usable.length) { notes.push(`${slot}: no listings with a known price under ${budget}c`); continue; }
    const texts = usable.map((x) => tradeItemToPoBText(x.l.item));
    let report;
    try {
      report = (await lua.call("test_items", { slot, items: texts })).result;
    } catch (error) {
      notes.push(`${slot}: PoB could not test items (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    (report.results as Array<{ ok: boolean; stats?: TestStats; rarity?: string }>).forEach((r, i) => {
      if (!r.ok || !r.stats) return;
      const { l, chaos } = usable[i];
      const ev = evaluateCandidate(report.base, r.stats, focus);
      // Not an upgrade: overall score too low, or a big loss on the focused stat.
      if (ev.score <= 0.5) return;
      if (focus !== "defence" && ev.dpsPct < -5) return;
      if (focus !== "dps" && ev.ehpPct < -5) return;
      const price = l.listing.price!;
      candidates.push({
        slot,
        name: [l.item.name, l.item.typeLine].filter(Boolean).join(", "),
        rarity: r.rarity,
        priceChaos: chaos!,
        priceText: `${price.amount} ${price.currency}`,
        ...ev,
        value: ev.score / Math.max(chaos!, 1),
        url: tradeUrl(args.league, searchId, l.id),
        itemText: texts[i],
        seller: l.listing.account?.name,
      });
    });
  }

  candidates.sort((a, b) => b.value - a.value || b.score - a.score);
  return { candidates: candidates.slice(0, Math.max(1, args.max_results ?? 8)), notes };
}

export function formatPlan(league: string, budget: number, result: { candidates: UpgradeCandidate[]; notes: string[] }): string {
  const lines = [`Upgrade plan: ${league}, up to ${budget}c per item, instant buyout only`, ""];
  if (!result.candidates.length) lines.push("No upgrades found within the budget for the searched slots.");
  result.candidates.forEach((c, i) => {
    const parts = [`DPS ${c.dpsPct >= 0 ? "+" : ""}${c.dpsPct.toFixed(1)}%`, `EHP ${c.ehpPct >= 0 ? "+" : ""}${c.ehpPct.toFixed(1)}%`];
    if (Math.abs(c.lifeDelta) >= 1) parts.push(`Life ${c.lifeDelta > 0 ? "+" : ""}${Math.round(c.lifeDelta)}`);
    lines.push(`${i + 1}. [${c.slot}] ${c.name} - ${c.priceText} (~${Math.round(c.priceChaos)}c)`);
    lines.push(`   ${parts.join(" | ")}${c.resNotes.length ? " | " + c.resNotes.join(", ") : ""}`);
    if (c.warnings.length) lines.push(`   Warning: ${c.warnings.join("; ")}`);
    lines.push(`   ${c.url}`);
  });
  if (result.notes.length) { lines.push("", "Notes:"); for (const note of result.notes) lines.push(`- ${note}`); }
  return lines.join("\n");
}
