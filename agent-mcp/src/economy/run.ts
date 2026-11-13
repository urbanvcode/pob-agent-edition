/**
 * Stage 5 entry points used by the trade tools: the total-budget plan (trade,
 * SSF and mixed) and the price check of the player's own items. Kept apart
 * from the tool definitions so the tools stay small.
 */
import { n } from "../format.js";
import { ToolError } from "../pob.js";
import { getProfile } from "../profile.js";
import type { Context } from "../registry.js";
import { ratesInfo } from "../trade/ninja.js";
import { DEFAULT_SLOTS } from "../trade/upgrades.js";
import { BudgetError, resolveBudget, type Budget } from "./budget.js";
import { craftHook, formatSell, formatSetPlan, targetsText, type Target } from "./report.js";
import { priceOwn, type OwnGem, type OwnItem } from "./sell.js";
import { planBudget } from "./setPlan.js";

type Focus = "balanced" | "dps" | "defence";

async function rates(league: string, notes: string[]): Promise<Map<string, number>> {
  try {
    const r = await ratesInfo(league);
    if (r.stale) notes.push(`poe.ninja is not answering; using its rates from ${new Date(r.at).toISOString().slice(0, 16).replace("T", " ")} UTC.`);
    return r.rates;
  } catch {
    notes.push("Could not load currency rates from poe.ninja; only chaos amounts are understood.");
    return new Map([["Chaos Orb", 1]]);
  }
}

export async function budgetOf(given: unknown, league: string, notes: string[]): Promise<Budget> {
  const r = await rates(league, notes);
  let b: Budget | undefined;
  try {
    b = resolveBudget(given, getProfile().profile, r);
  } catch (e) {
    if (e instanceof BudgetError) throw new ToolError(e.message);
    throw e;
  }
  if (!b) throw new ToolError('No budget: give one (e.g. "3 div + 150c") or set the currency on hand in the profile (profile_set).');
  if (b.chaos < 1) throw new ToolError(`Budget ${b.text} is under 1 chaos.`);
  return b;
}

/** SSF (and the mixed alternative): what a rare should carry per slot, plus the craft/farm hooks. */
export async function ssfTargets(ctx: Context, slots: string[], focus: Focus): Promise<Target[]> {
  const link = await ctx.pob.link();
  return (await link.call("economy_targets", { slots, focus, top: 6 })).result as Target[];
}

export async function budgetPlanText(ctx: Context, a: { league: string; leagueNote?: string; budget: unknown; focus?: Focus; slots?: string[] }): Promise<string> {
  const profile = getProfile().profile;
  const focus: Focus = a.focus ?? (profile.hardcore ? "defence" : "balanced");
  const slots = a.slots?.length ? a.slots : DEFAULT_SLOTS;
  const link = await ctx.pob.link();

  if (profile.playMode === "ssf") {
    const targets = await ssfTargets(ctx, slots, focus);
    return [
      "SSF plan (the profile is Solo Self-Found: no trading, so no budget or purchases). What to keep from your own drops, per slot:",
      ...targetsText(targets),
      "", "Next steps:", ...slots.map((s) => `- ${craftHook(s, (targets.find((t) => t.slot === s)?.stats ?? []).slice(0, 3).map((x) => x.text))}`),
      "- [SSF] uniques the build wants: kb_lookup the name for where it drops; farming plans come with the farming advisor (Stage 8).",
      "", "Thresholds are from PoB's own upgrade weights for this build (no trade request was made).",
    ].join("\n");
  }

  const notes: string[] = [];
  const budget = await budgetOf(a.budget, a.league, notes);
  const plan = await planBudget(link, ctx.trade, { league: a.league, budgetChaos: budget.chaos, focus, slots, noDefenceLoss: profile.hardcore });
  plan.notes.unshift(...notes);
  if (a.leagueNote) plan.notes.push(a.leagueNote);
  if (budget.source === "profile") plan.notes.push("Budget = the currency on hand in the profile; give budget to plan with a different amount.");

  // Selling what the plan replaces: priced from poe.ninja, no trade requests.
  let replaced;
  if (plan.buy.length) {
    try {
      const own = (await link.call("economy_items")).result as { items: OwnItem[]; gems: OwnGem[] };
      const items = own.items.filter((i) => i.slot && plan.buy.some((b) => b.slot === i.slot));
      replaced = (await priceOwn(a.league, { items, gems: [] })).priced;
    } catch { /* the plan is complete without it */ }
  }
  const divine = (await rates(a.league, [])).get("Divine Orb");
  let text = formatSetPlan(plan, budget, { mode: profile.playMode, replacedValue: replaced, divine });
  if (profile.playMode === "mixed") {
    const targets = await ssfTargets(ctx, plan.buy.length ? plan.buy.map((b) => b.slot) : slots.slice(0, 4), focus).catch(() => []);
    if (targets.length) text += `\n\n[SSF] What to keep from your own drops instead:\n${targetsText(targets).join("\n")}`;
  }

  if (link.kind === "live" && plan.buy.length) {
    try {
      await link.call("set_advisor", {
        league: a.league, budget: plan.budget, focus, time: Date.now(),
        items: plan.buy.map((c) => ({
          slot: c.slot, name: c.name, rarity: c.rarity, priceText: c.priceText, priceChaos: c.priceChaos,
          dpsPct: c.dpsPct, ehpPct: c.ehpPct, lifeDelta: c.lifeDelta, resNotes: c.resNotes, warnings: [...c.warnings, ...c.sanity],
          url: c.url, itemText: c.itemText, seller: c.seller,
        })),
        notes: [plan.combined ? `Set of ${plan.buy.length} for ${n(plan.spent)}c: DPS ${plan.combined.dpsPct.toFixed(1)}%, EHP ${plan.combined.ehpPct.toFixed(1)}% together` : `Set of ${plan.buy.length} for ${n(plan.spent)}c`, ...plan.notes],
      });
      text += "\nAlso shown in PoB Agent Edition > Overview > Advisor.";
    } catch { /* the text is complete without the card */ }
  }
  const stats = await link.call("key_stats").catch(() => null);
  if (stats) text += `\nConfig assumptions: ${stats.assumptions}.`;
  return text;
}

/** Prices of the build's own items and gems; what to sell to fund upgrades. */
export async function sellText(ctx: Context, league: string, leagueNote?: string): Promise<string> {
  const link = await ctx.pob.link();
  const own = (await link.call("economy_items")).result as { items: OwnItem[]; gems: OwnGem[] };
  const { priced, notes } = await priceOwn(league, own);
  const r = await rates(league, notes);
  if (leagueNote) notes.push(leagueNote);
  if (getProfile().profile.playMode === "ssf") notes.unshift("The profile is SSF: you cannot trade these; the prices only show what is valuable to keep.");
  return `${formatSell(priced, notes, r.get("Divine Orb"))}\n(League ${league}; no trade request was made.)`;
}
