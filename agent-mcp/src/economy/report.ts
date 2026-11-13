/**
 * Text for the economy results (Stage 5): the total-budget plan, what to sell,
 * and the SSF / mixed outputs with hooks for the crafting (Stage 6) and
 * farming (Stage 8) helpers.
 */
import { n } from "../format.js";
import type { Budget } from "./budget.js";
import type { Priced } from "./sell.js";
import type { PlanItem, SetPlan } from "./setPlan.js";

const sign = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;
const chaos = (c: number) => (c >= 1 ? n(Math.round(c)) : c.toFixed(2));

export interface Target {
  slot: string;
  current?: string;
  currentRarity?: string;
  stats?: Array<{ text: string; value: number; alone?: number; max?: number }>;
  error?: string;
}

/** "Good enough" rare thresholds per slot (SSF loot to keep, loot filter ideas). */
export function targetsText(targets: Target[], max = 4): string[] {
  const L: string[] = [];
  for (const t of targets) {
    if (t.error || !t.stats?.length) { L.push(`- ${t.slot}: ${t.error ?? "PoB found no stat that beats the current item"}`); continue; }
    // Rolls are whole numbers: round the threshold up.
    const top = t.stats.slice(0, max).map((s) => s.alone !== undefined
      ? `${s.text.replace(/#/, n(Math.ceil(s.alone)))} [value ${s.value}]`
      : `${s.text}${s.max !== undefined ? ` (top roll ${n(s.max)}, helps with others)` : ""} [value ${s.value}]`);
    L.push(`- ${t.slot} (now: ${t.current ?? "empty"}): keep a rare with ${top.join(" | ")}`);
  }
  if (L.length) L.push("  A number = about how much of that stat ALONE beats the current item; two or three stats at lower rolls also do. [value] = what a top roll is worth to this build (best = 100).");
  return L;
}

/** Hooks to the later stages; until they exist the line says which tool to use now. */
export function craftHook(slot: string): string {
  return `[SSF] craft: open prefix/suffix bench crafts with affixes { slot: "${slot}" }; full craft plans come with the crafting helper (Stage 6)`;
}
export function farmHook(name: string): string {
  return `[SSF] farm: kb_lookup "${name}" for where it drops (drop-restricted, boss or div card); farming plans come with the farming advisor (Stage 8)`;
}

function itemLine(i: number, p: PlanItem): string[] {
  const parts = [`DPS ${sign(p.dpsPct)}`, `EHP ${sign(p.ehpPct)}`];
  if (Math.abs(p.lifeDelta) >= 1) parts.push(`Life ${p.lifeDelta > 0 ? "+" : ""}${Math.round(p.lifeDelta)}`);
  const L = [`${i}. [${p.slot}] ${p.name} - ${p.priceText} (~${chaos(p.priceChaos)}c)`, `   alone: ${parts.join(" | ")}${p.resNotes.length ? ` | ${p.resNotes.join(", ")}` : ""}`];
  if (p.warnings.length) L.push(`   alone it would: ${p.warnings.join("; ")} (the set covers it)`);
  if (p.sanity.length) L.push(`   Check: ${p.sanity.join("; ")}`);
  L.push(`   ${p.url}`);
  return L;
}

export function formatSetPlan(plan: SetPlan, budget: Budget, opts: { mode: string; replacedValue?: Priced[]; divine?: number } = { mode: "trade" }): string {
  const div = opts.divine && opts.divine > 0 ? opts.divine : undefined;
  const inDiv = (c: number) => (div && c >= div ? ` (${n(c / div, 1)} div)` : "");
  const L = [`Budget plan: ${plan.league}, total ${budget.text}, instant buyout only, focus ${plan.focus}`];
  if (!plan.buy.length) {
    L.push("", "BUY NOW: nothing within the budget improves the build in the searched slots.");
  } else {
    L.push("", `BUY NOW (${plan.buy.length} item(s), ${chaos(plan.spent)}c${inDiv(plan.spent)} of ${chaos(plan.budget)}c; ${chaos(plan.left)}c left)`);
    plan.buy.forEach((p, i) => L.push(...itemLine(i + 1, p)));
    const c = plan.combined;
    if (c) {
      L.push(`   TOGETHER (simulated as one set in PoB): DPS ${sign(c.dpsPct)} | EHP ${sign(c.ehpPct)}${Math.abs(c.lifeDelta) >= 1 ? ` | Life ${c.lifeDelta > 0 ? "+" : ""}${Math.round(c.lifeDelta)}` : ""}${c.resNotes.length ? ` | ${c.resNotes.join(", ")}` : ""}`);
      if (plan.buy.length > 1) L.push(`   One by one they add up to DPS ${sign(plan.singles.dpsPct)} | EHP ${sign(plan.singles.ehpPct)}; the set number is the real one (gains overlap).`);
      L.push(c.warnings.length ? `   Warning: ${c.warnings.join("; ")}` : "   Resistances, attribute requirements and mana stay valid with the whole set.");
    }
  }
  const sold = (opts.replacedValue ?? []).filter((p) => p.chaos && plan.buy.some((b) => b.slot === p.slot));
  if (sold.length) {
    const total = sold.reduce((s, p) => s + (p.chaos ?? 0), 0);
    L.push("", `SELL AFTER BUYING: the plan replaces ${sold.map((p) => `${p.name} (~${chaos(p.chaos!)}c, ${p.basis})`).join(", ")} = about ${chaos(total)}c back.`);
  }
  if (plan.saveFor.length) {
    L.push("", "SAVE FOR (better than what fits now)");
    plan.saveFor.forEach((p, i) => {
      L.push(`${i + 1}. [${p.slot}] ${p.name} - ${p.priceText} (~${chaos(p.priceChaos)}c${inDiv(p.priceChaos)}): DPS ${sign(p.dpsPct)} | EHP ${sign(p.ehpPct)}${p.resNotes.length ? ` | ${p.resNotes.join(", ")}` : ""} alone; about ${chaos(p.more)}c more than you can spend on that slot now`);
      L.push(`   ${p.url}`);
    });
  }
  if (opts.mode === "mixed" && plan.buy.length) {
    L.push("", "OR CRAFT / FARM INSTEAD");
    for (const p of plan.buy) L.push(`- [${p.slot}] ${p.rarity === "UNIQUE" ? farmHook(p.name.split(",")[0]) : craftHook(p.slot)}`);
  }
  if (plan.notes.length) { L.push("", "Notes:"); for (const x of plan.notes) L.push(`- ${x}`); }
  L.push("", `Searched: ${plan.searched.join(", ") || "nothing"}; ${plan.sims} combined simulation(s). Prices from instant-buyout listings; the player buys by opening each link.`);
  return L.join("\n");
}

export function formatSell(priced: Priced[], notes: string[], divine?: number, limit = 12): string {
  const inDiv = (c: number) => (divine && c >= divine ? ` (${n(c / divine, 1)} div)` : "");
  const spare = priced.filter((p) => p.spare && p.chaos);
  const worn = priced.filter((p) => !p.spare && p.chaos);
  const unpriced = priced.filter((p) => !p.chaos);
  const L = ["What your items are worth (poe.ninja; a sale usually goes a little under these prices)"];
  const line = (p: Priced) => `- ${p.name}${p.slot ? ` [${p.slot}]` : ""}: ~${chaos(p.chaos!)}c${inDiv(p.chaos!)} (${p.basis})`;
  if (spare.length) {
    const total = spare.reduce((s, p) => s + p.chaos!, 0);
    L.push("", `SELL NOW (not used by the build): about ${chaos(total)}c${inDiv(total)}`, ...spare.slice(0, limit).map(line));
  } else L.push("", "SELL NOW: no unused item or gem in this build has a poe.ninja price.");
  if (worn.length) L.push("", "IN USE (what you would get back after an upgrade replaces it)", ...worn.slice(0, limit).map(line));
  if (unpriced.length) L.push("", "NO AUTOMATIC PRICE", ...unpriced.slice(0, limit).map((p) => `- ${p.name}${p.slot ? ` [${p.slot}]` : ""}: ${p.basis}`));
  if (notes.length) L.push("", ...notes.map((x) => `- ${x}`));
  return L.join("\n");
}
