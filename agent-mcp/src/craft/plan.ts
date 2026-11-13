/**
 * Crafting helper (roadmap Stage 6): affixes { craft }.
 *
 * Target (wanted stats, or a target item such as a guide item) -> the base's
 * mod pool from PoB (spawn weights, tiers, essences, bench, eldritch) -> odds
 * per method (odds.ts) -> expected currency at poe.ninja prices, stop-and-buy
 * points, buy vs craft (one instant-buyout search) and the finished item
 * simulated in the build. Every crafting rule used is cited (facts.ts); what
 * the sources do not give is a range or "unknown". Read-only: nothing is
 * changed, bought or crafted; the player does every step in game.
 */
import { n } from "../format.js";
import { getProfile } from "../profile.js";
import { ToolError } from "../pob.js";
import type { Context } from "../registry.js";
import { fairPrice } from "../economy/sanity.js";
import { priceInChaos, tradeItemToPoBText } from "../trade/itemText.js";
import { ninjaItemLines, ratesInfo } from "../trade/ninja.js";
import { evaluateCandidate, INSTANT_BUYOUT, tradeUrl, type TestStats } from "../trade/upgrades.js";
import type { TradeQuery } from "../trade/types.js";
import { FACTS, UNKNOWN, cite } from "./facts.js";
import { altOdds, rareMix, triesFor, unitsOf, type BenchOption, type Hits } from "./odds.js";
import { atRoll, hitsOf, parseWants, share, template, unmatched, wantRule, type Pool, type PoolLine, type Want } from "./target.js";

export interface CraftArgs { craft: string; slot?: string; item_text?: string; base?: string; ilvl?: number; focus?: string; league?: string }

export interface Method {
  name: string;
  steps: string[];
  /** Expected chaos: low / mid / high (undefined = a price is unknown). */
  cost: { low?: number; mid?: number; high?: number };
  /** Orbs used, for SSF and when a price is missing. */
  orbs: string;
  pTry: number;
  /** Expected tries of the main orb (ranking when a price is missing). */
  effort: number;
  tryCost?: number;
  tryName: string;
  risk: "low" | "medium" | "high";
  ssf: string;
  facts: string[];
  notes: string[];
}

const CATEGORY: Record<string, string> = {
  Ring: "accessory.ring", Amulet: "accessory.amulet", Belt: "accessory.belt", Helmet: "armour.helmet", Gloves: "armour.gloves",
  Boots: "armour.boots", "Body Armour": "armour.chest", Shield: "armour.shield", Quiver: "armour.quiver",
};

const pctText = (p: number) => (p >= 0.1 ? `${(p * 100).toFixed(0)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : p > 0 ? `1 in ${n(Math.round(1 / p))}` : "0");
const c = (x: number | undefined) => (x === undefined ? "?" : x >= 10 ? `${n(Math.round(x))}c` : `${x.toFixed(1)}c`);
const riskOf = (p: number): Method["risk"] => (p >= 0.05 ? "low" : p >= 0.005 ? "medium" : "high");

async function rates(league: string, notes: string[]): Promise<Map<string, number>> {
  if (!league) return new Map([["Chaos Orb", 1]]);
  try {
    const r = await ratesInfo(league);
    if (r.stale) notes.push("poe.ninja could not be reached: prices are from an older saved copy.");
    return r.rates;
  } catch {
    notes.push("Could not load poe.ninja prices: costs are shown in orbs only.");
    return new Map([["Chaos Orb", 1]]);
  }
}

/** A guide item (or any item) -> wants: each rolled mod at its tier or better, bench mods as they are. */
async function wantsFromItem(ctx: Context, text: string, skipped: string[]): Promise<Want[]> {
  const it = (await (await ctx.pob.link(false)).call("classify_item", { text })).item;
  if (!Array.isArray(it?.mods) || !it.mods.length) throw new ToolError(`PoB found no prefixes or suffixes on that item${it?.notes?.length ? `: ${it.notes.join(" ")}` : ""}.`);
  const wants: Want[] = [];
  for (const m of it.mods as Array<{ lines: string[]; range: string[]; tier?: number; source: string }>) {
    if (!m.range?.length || m.range.length !== 1) { skipped.push(m.lines.join(" / ")); continue; } // hybrid mods: named in the plan
    const t = template(m.range[0]);
    const re = new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    wants.push({ text: m.lines.join(" / "), count: 1, alts: [{ label: m.lines.join(" / "), re }], maxTier: m.source === "bench" ? undefined : m.tier, min: m.source === "bench" ? undefined : undefined });
  }
  return wants;
}

function benchOptions(bench: PoolLine[], wants: Want[]): BenchOption[] {
  const out: BenchOption[] = [];
  wants.forEach((w, wi) => w.alts.forEach((a, ai) => {
    let best = 0, type: "Prefix" | "Suffix" | undefined;
    for (const b of bench) {
      const s = share(b.lines, a, w, true);
      if (s > best) { best = s; type = b.type as "Prefix" | "Suffix"; }
    }
    if (type && best > 0) out.push({ want: wi, alt: ai, type, share: best });
  }));
  return out;
}

const benchLine = (bench: PoolLine[], w: Want, altIdx: number) => {
  const a = w.alts[altIdx];
  return bench.filter((b) => share(b.lines, a, w, true) > 0).sort((x, y) => y.level - x.level)[0];
};

/** Wants without one unit (the one the bench will add). */
function minusUnit(wants: Want[], want: number, alt: number): Want[] {
  return wants.map((w, i) => (i !== want ? w : { ...w, count: w.count - 1, alts: w.alts.map((a, j) => (j === alt ? { label: a.label, re: /(?!)/ } : a)) }))
    .filter((w) => w.count > 0);
}

function stopLine(p: number, tryCost: number | undefined, tryName: string, budget?: number): string {
  const t50 = triesFor(p, 0.5), t90 = triesFor(p, 0.9);
  const cost = (t: number) => (tryCost !== undefined ? ` (~${c(t * tryCost)})` : "");
  let s = `Stop points: 50% of crafters are done within ${n(t50)} ${tryName}${cost(t50)}, 90% within ${n(t90)}${cost(t90)}.`;
  if (budget !== undefined && tryCost && tryCost > 0) {
    const t = Math.floor(budget / tryCost);
    if (t < t90) s += ` Your ${c(budget)} buys about ${n(t)} tries = ${pctText(1 - Math.pow(1 - p, t))} chance: set that as your stop-and-buy point.`;
  }
  return s;
}

/** Alteration (+ Augmentation) -> Regal -> bench. Only when the wants fit a magic item plus one or two more mods. */
function altMethod(pool: Pool, hits: Hits, wants: Want[], bench: BenchOption[], price: (name: string) => number | undefined): Method | undefined {
  const units = unitsOf(wants);
  const options: Array<{ rolled: Want[]; bench?: BenchOption; hits: Hits }> = [{ rolled: wants, hits }];
  for (const b of bench) {
    const rolled = minusUnit(wants, b.want, b.alt);
    options.push({ rolled, bench: b, hits: hitsOf(pool.mods, rolled) });
  }
  const alt = price("Orb of Alteration"), aug = price("Orb of Augmentation"), regal = price("Regal Orb");
  const scour = price("Orb of Scouring"), trans = price("Orb of Transmutation");
  let best: Method | undefined;
  for (const o of options) {
    const u = unitsOf(o.rolled);
    if (u < 1 || u > 3) continue;
    const goal = Math.min(u, 2);
    const odds = altOdds(pool.mods, o.hits, o.rolled, goal);
    if (odds.p <= 0) continue;
    const needRegal = u === 3;
    const pRegal = needRegal ? odds.regal : 1;
    if (pRegal <= 0) continue;
    const tries = 1 / odds.p;
    const lowTry = alt, highTry = alt !== undefined && aug !== undefined ? alt + aug : undefined;
    const restart = (scour ?? 0) + (trans ?? 0);
    const total = (perTry: number | undefined) => (perTry === undefined || regal === undefined ? undefined
      : needRegal ? (tries * perTry + regal) / pRegal + (1 / pRegal - 1) * restart : tries * perTry + ((o.bench || units > 2) ? regal : 0));
    const low = total(lowTry), high = total(highTry);
    const mid = low !== undefined && high !== undefined ? (low + high) / 2 : undefined;
    const goalText = o.rolled.map((w) => w.alts.filter((a) => !/\(\?!\)/.test(a.re.source)).map((a) => a.label).join(" or ")).map((t, i) => (o.rolled[i].count > 1 ? `${o.rolled[i].count} of ${t}` : t)).join("; ");
    const steps = [
      `Get a normal ${pool.base} with item level ${pool.ilvl}+ and make it magic with an Orb of Transmutation.`,
      `Orb of Alteration until it shows ${u > goal ? `${goal === 2 ? "two" : "one"} of these` : goal === 2 ? "both" : "this"}: ${goalText}. If it rolled only one mod, an Orb of Augmentation adds the other side. Chance per try: ${pctText(odds.p)} (about ${n(Math.ceil(tries))} tries).`,
    ];
    if (needRegal) steps.push(`Regal Orb: adds one random mod; ${pctText(pRegal)} chance it is the third one you want. Miss: Orb of Scouring, Transmutation, back to step 2 (or keep it if the miss is good).`);
    else if (o.bench || units > 2) steps.push(`Regal Orb (makes it rare; its random mod is a bonus).`);
    if (o.bench) {
      const line = benchLine(pool.bench, wants[o.bench.want], o.bench.alt);
      if (line) steps.push(`Crafting bench: "${atRoll(line.lines[0])}" (${line.type.toLowerCase()}; cost shown on the bench; needs the recipe unlocked).`);
    }
    if (!needRegal && !o.bench && units <= 2) steps.push("Done as a magic item. A Regal Orb then adds one random mod (more stats, cannot fail).");
    const m: Method = {
      name: o.bench ? "Alteration + Regal + bench craft" : "Alteration + Regal",
      steps, cost: { low, mid, high }, pTry: odds.p, tryCost: lowTry !== undefined && highTry !== undefined ? (lowTry + highTry) / 2 : undefined,
      tryName: "alterations", risk: riskOf(odds.p * pRegal), effort: tries / pRegal,
      orbs: `about ${n(Math.ceil(tries / pRegal))} Orbs of Alteration (up to as many Augmentations)${needRegal ? `, ${n(Math.ceil(1 / pRegal))} Regal Orbs` : (o.bench || units > 2) ? ", 1 Regal Orb" : ""}`,
      ssf: "all from drops (Alteration, Augmentation, Regal, Scouring, Transmutation); a vendor sells 1 Alteration for 4 Augmentations",
      facts: ["weights", "group", "limits", "transmutation", "alteration", "augmentation", "altVendor", "regal", ...(o.bench ? ["bench", "benchUnlock"] : [])],
      notes: [UNKNOWN.alterationCount],
    };
    if (!best || (m.cost.mid !== undefined && best.cost.mid !== undefined ? m.cost.mid < best.cost.mid : m.effort < best.effort)) best = m;
  }
  return best;
}

function rareMethod(name: string, pool: Pool, hits: Hits, wants: Want[], bench: BenchOption[], tryName: string, tryCost: number | undefined,
  guaranteed?: { line: PoolLine; hits: Hits[number] }): Method | undefined {
  const odds = rareMix(pool.mods, hits, wants, { limit: pool.limit, bench, guaranteed: guaranteed ? { type: guaranteed.line.type as "Prefix" | "Suffix", group: guaranteed.line.group, hits: guaranteed.hits } : undefined });
  if (odds.pBench <= 0) return undefined;
  const usesBench = odds.pBench > odds.p * 1.05;
  const p = odds.pBench;
  const exp = (q: number) => (tryCost !== undefined && q > 0 ? tryCost / q : undefined);
  const steps = guaranteed
    ? [`${guaranteed.line.name} on a normal ${pool.base} (ilvl ${pool.ilvl}+): makes it rare with "${atRoll(guaranteed.line.lines[0])}" guaranteed and random other mods.`,
      `Repeat on the rare (if this essence can reroll rares) or scour and repeat, until the other wants roll. Chance per essence: ${pctText(p)} (range ${pctText(odds.lowBench)} with 4 mods to ${pctText(odds.highBench)} with 6).`]
    : [`Make a normal ${pool.base} (ilvl ${pool.ilvl}+) rare with an Orb of Alchemy.`,
      `Chaos Orb until it has all of the wants. Chance per Chaos Orb: ${pctText(p)} (range ${pctText(odds.lowBench)} with 4 mods to ${pctText(odds.highBench)} with 6).`];
  if (usesBench) steps.push("Then add the one missing want with the crafting bench (an open prefix/suffix of that type is needed; counted in the chance above).");
  return {
    name, steps, cost: { low: exp(odds.highBench), mid: exp(p), high: exp(odds.lowBench) }, pTry: p, effort: 1 / p, tryCost, tryName, risk: riskOf(p),
    orbs: `about ${n(Math.ceil(1 / p))} ${tryName}`,
    ssf: guaranteed ? "essences come from Essence Monoliths (imprisoned monsters)" : "Chaos Orbs and Orbs of Alchemy drop",
    facts: ["weights", "group", "modLevel", "limits", "rareCount", ...(guaranteed ? ["essence", "essenceRare", "essenceDrop"] : ["alchemy", "chaos"]), ...(usesBench ? ["bench"] : [])],
    notes: [UNKNOWN.rareCountUse, ...(guaranteed ? ["Which essences can reroll a rare is not listed in PoB's data: check the essence's own text in game."] : [])],
  };
}

async function essencePrices(league: string): Promise<Map<string, number>> {
  if (!league) return new Map();
  try { return new Map((await ninjaItemLines(league, "Essence")).map((l) => [l.name, l.chaosValue])); } catch { return new Map(); }
}

/** Instant-buyout listings with every want (the "and" of each stat at its lowest wanted value); cheapest first. */
async function buyCheck(ctx: Context, pool: Pool, wants: Want[], league: string, rates: Map<string, number>, slot?: string) {
  const category = CATEGORY[pool.class];
  if (!category || !league) return undefined;
  const ids: Array<{ alts: Array<{ id: string; min?: number }>; count: number }> = [];
  for (const [wi, w] of wants.entries()) {
    const alts: Array<{ id: string; min?: number }> = [];
    w.alts.forEach((_, ai) => {
      const ms = pool.mods.filter((m, mi) => hitsOf([m], [w])[0].some((h) => h.alt === ai) && m.trade?.length && mi >= 0);
      if (!ms.length) return;
      const mins = ms.map((m) => Math.min(...(atRoll(m.lines[0], 0).match(/-?\d+(\.\d+)?/g) ?? ["0"]).map(Number)));
      alts.push({ id: ms[0].trade![0], min: w.min ?? Math.min(...mins) });
    });
    if (!alts.length) return { note: `"${wants[wi].text}" has no trade stat id in PoB's data: buy check skipped.` };
    ids.push({ alts, count: w.count });
  }
  const and = ids.filter((x) => x.alts.length === 1 && x.count === 1).map((x) => ({ id: x.alts[0].id, value: { min: x.alts[0].min } }));
  const counts = ids.filter((x) => !(x.alts.length === 1 && x.count === 1)).map((x) => ({ type: "count" as const, value: { min: x.count }, filters: x.alts.map((a) => ({ id: a.id, value: { min: a.min } })) }));
  const q: TradeQuery = {
    query: {
      status: { option: INSTANT_BUYOUT },
      stats: [{ type: "and", filters: and }, ...counts],
      filters: { type_filters: { filters: { category: { option: category }, rarity: { option: "nonunique" } } } },
    },
    sort: { price: "asc" },
  };
  try {
    const search = await ctx.trade.searchItems(league, q);
    if (!search.result?.length) return { note: "No instant-buyout listing has all the wants right now: crafting is the way (or loosen a want).", url: tradeUrl(league, search.id) };
    const listings = await ctx.trade.fetchItems(search.result.slice(0, 8), search.id);
    const priced = listings.map((l) => ({ l, chaos: priceInChaos(l.listing.price, rates) })).filter((x): x is { l: typeof listings[number]; chaos: number } => x.chaos !== undefined);
    const fair = fairPrice(priced.map((x) => ({ chaos: x.chaos, indexed: x.l.listing.indexed })));
    let sim: string | undefined;
    if (slot && priced.length) {
      const cheapest = priced.sort((a, b) => a.chaos - b.chaos).find((x) => x.chaos >= (fair?.low ?? 0)) ?? priced[0];
      try {
        const rep = (await (await ctx.pob.link()).call("test_items", { slot, items: [tradeItemToPoBText(cheapest.l.item)] })).result;
        const r0 = rep.results?.[0];
        if (r0?.ok) { const ev = evaluateCandidate(rep.base, r0.stats, "balanced"); sim = `the cheapest fair one in ${slot}: DPS ${ev.dpsPct >= 0 ? "+" : ""}${ev.dpsPct.toFixed(1)}%, EHP ${ev.ehpPct >= 0 ? "+" : ""}${ev.ehpPct.toFixed(1)}% (PoB)`; }
      } catch { /* simulation is a bonus */ }
    }
    return { total: search.total, fair, url: tradeUrl(league, search.id), sim };
  } catch (error) {
    return { note: `Buy check: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The finished item, simulated: each want at its best qualifying tier, average roll; count wants tried in each combination. */
async function simulateTarget(ctx: Context, pool: Pool, wants: Want[], slot: string | undefined, focus: string) {
  if (!slot) return undefined;
  const hits = hitsOf(pool.mods, wants);
  const pick = (wi: number, ai: number) => {
    const cands = pool.mods.map((m, i) => ({ m, h: hits[i].find((x) => x.want === wi && x.alt === ai) })).filter((x) => x.h);
    cands.sort((a, b) => b.h!.share - a.h!.share || a.m.tier - b.m.tier);
    return cands[0]?.m;
  };
  const combos = (k: number, nAlts: number): number[][] => {
    const out: number[][] = [];
    const rec = (start: number, acc: number[]) => { if (acc.length === k) { out.push(acc); return; } for (let i = start; i < nAlts; i++) rec(i + 1, [...acc, i]); };
    rec(0, []);
    return out.slice(0, 4);
  };
  let sets: Array<Array<{ id: string; range: number }>> = [[]];
  for (const [wi, w] of wants.entries()) {
    const next: typeof sets = [];
    for (const s of sets) for (const combo of combos(w.count, w.alts.length)) {
      const mods = combo.map((ai) => pick(wi, ai)).filter(Boolean);
      if (mods.length !== combo.length) continue;
      next.push([...s, ...mods.map((m) => ({ id: m!.id, range: 0.5 }))]);
    }
    sets = next.slice(0, 6);
  }
  const fits = (set: Array<{ id: string }>) => {
    const t = { Prefix: 0, Suffix: 0 }, groups = new Set<string>();
    for (const s of set) { const m = pool.mods.find((x) => x.id === s.id)!; t[m.type]++; if (groups.has(m.group)) return false; groups.add(m.group); }
    return t.Prefix <= pool.limit && t.Suffix <= pool.limit;
  };
  sets = sets.filter((s) => s.length && fits(s));
  if (!sets.length) return { note: "The wants do not fit on one item together (too many prefixes or suffixes, or the same mod group)." };
  const link = await ctx.pob.link();
  const items = (await link.call("craft_items", { base: pool.base, ilvl: pool.ilvl, sets })).result.items as Array<{ ok: boolean; text?: string }>;
  const texts = items.filter((x) => x.ok && x.text).map((x) => x.text!);
  if (!texts.length) return { note: "PoB could not build the target item." };
  const rep = (await link.call("test_items", { slot, items: texts })).result;
  let best: { ev: ReturnType<typeof evaluateCandidate>; text: string } | undefined;
  (rep.results as Array<{ ok: boolean; stats?: TestStats }>).forEach((r, i) => {
    if (!r.ok || !r.stats) return;
    const ev = evaluateCandidate(rep.base, r.stats, focus);
    if (!best || ev.score > best.ev.score) best = { ev, text: texts[i] };
  });
  if (!best) return { note: "PoB could not simulate the target item." };
  const lines = best.text.split("\n").filter((l) => /^\{tags|^\{crafted\}|^\{range/.test(l) || false).map((l) => l.replace(/^\{[^}]*\}/g, "").replace(/^\{[^}]*\}/g, ""));
  return { ev: best.ev, lines, current: rep.current?.name };
}

/** Bench quick fixes: every bench craft that fits an open prefix/suffix of the slot's item, simulated and ranked. */
export async function benchFixes(ctx: Context, slot: string, focus: string): Promise<string> {
  const link = await ctx.pob.link();
  const it = (await link.call("classify_item", { slot })).item;
  if (!it.prefixes) return [`${slot}: ${it.name}`, ...(it.notes ?? [])].join("\n");
  const open = { Prefix: it.prefixes.limit - it.prefixes.used, Suffix: it.suffixes.limit - it.suffixes.used };
  const crafted = (it.mods as Array<{ source: string; lines: string[] }>).filter((m) => m.source === "bench");
  const res = (await link.call("craft_fix", { slot })).result as { items: Array<{ type: string; line: string; text: string; group: string }>; base: string };
  const L = [`Bench quick fixes for ${slot} (${it.name}): open prefixes ${open.Prefix}, open suffixes ${open.Suffix}.`];
  if (crafted.length) L.push(`It already has a bench craft (${crafted.map((m) => m.lines.join(" / ")).join("; ")}): a new one replaces it for an extra Orb of Scouring. ${cite("bench")}`);
  const cands = res.items.filter((x) => open[x.type as "Prefix" | "Suffix"] > 0 || crafted.length > 0);
  if (!cands.length) return [...L, "No open prefix or suffix: the bench cannot add a mod here (a new item or a craft plan: affixes { craft })."].join("\n");
  const rep = (await link.call("test_items", { slot, items: cands.map((x) => x.text) })).result;
  const ranked = cands.map((x, i) => ({ x, r: rep.results[i] })).filter((y) => y.r?.ok).map((y) => ({ ...y, ev: evaluateCandidate(rep.base, y.r.stats, focus) }))
    .sort((a, b) => b.ev.score - a.ev.score).slice(0, 8);
  if (!ranked.some((y) => y.ev.score > 0.5)) L.push(crafted.length ? "None beats the bench craft it has now: keep it." : "None of them improves the build in this slot.");
  ranked.forEach((y, i) => L.push(`${i + 1}. ${y.x.type} "${y.x.line}": DPS ${y.ev.dpsPct >= 0 ? "+" : ""}${y.ev.dpsPct.toFixed(1)}% | EHP ${y.ev.ehpPct >= 0 ? "+" : ""}${y.ev.ehpPct.toFixed(1)}%${y.ev.resNotes.length ? ` | ${y.ev.resNotes.join(", ")}` : ""}${y.ev.warnings.length ? ` | ${y.ev.warnings.join(", ")}` : ""}`));
  L.push("Average roll of each craft's range, simulated in PoB in this slot (nothing changed). Highest bench tier shown: you need its recipe unlocked; costs are shown on the bench. Preview one: what_if with the item text.",
    `Sources: ${cite("benchUnlock")}; ${UNKNOWN.benchCost}`);
  return L.join("\n");
}

/** Other methods for this league, cited, with no computed odds (their weights are not in our data). */
function otherMethods(pool: Pool, wants: Want[], units: number): string[] {
  const L = ["Other methods this league (odds not computed):"];
  L.push(`- Fossils: ${cite("fossils")}. ${UNKNOWN.fossilWeights}`);
  L.push(`- Harvest: ${cite("harvest")}. ${UNKNOWN.harvestWeights} A resist of the wrong element can be swapped: ${cite("harvestRes")}.`);
  if (units >= 3) L.push(`- Meta-crafting: lock what you hit, then reroll the rest. ${cite("metaPrefix")} ${cite("metaRecipes")}`);
  L.push(`- Recombinator: ${cite("recombinator")}.`);
  const eld = pool.eldritch.filter((e) => wants.some((w) => w.alts.some((a) => e.lines.length === 1 && a.re.test(template(e.lines[0])))));
  if (eld.length) L.push(`- Eldritch implicits (Exarch/Eater, PoB data) for wants: ${eld.map((e) => `"${e.lines[0]}"`).join("; ")}.`);
  return L;
}

export interface CraftResult { text: string; best?: Method; buyChaos?: number }

export async function craftPlan(ctx: Context, args: CraftArgs): Promise<CraftResult> {
  const profile = getProfile().profile;
  const ssf = profile.playMode === "ssf";
  const focus = args.focus ?? (profile.hardcore ? "defence" : "balanced");
  const notes: string[] = [];
  const itemMode = args.craft.trim().toLowerCase() === "item";
  if (itemMode && !args.item_text) throw new ToolError('craft: "item" needs item_text (the target item, e.g. a guide item copied from PoB).');
  const skipped: string[] = [];
  const wants = itemMode ? await wantsFromItem(ctx, args.item_text!, skipped) : parseWants(args.craft);
  if (skipped.length) notes.push(`Hybrid mods on the target are not planned (two stats in one mod): ${skipped.join("; ")}.`);
  if (!wants.length) throw new ToolError('Give the wanted stats, e.g. craft: "life, 2 res, crit multi".');
  if (unitsOf(wants) > 6) throw new ToolError("More than 6 wanted mods: an item holds at most 3 prefixes and 3 suffixes.");

  const link = await ctx.pob.link(!(args.base || (itemMode && args.item_text)));
  const poolArgs = { slot: args.slot, text: itemMode ? args.item_text : undefined, base: args.base, ilvl: args.ilvl };
  const pool = (await link.call("craft_pool", poolArgs)).result as Pool;
  const hits = hitsOf(pool.mods, wants);
  const missing = unmatched(pool.mods, wants);
  // SSF: no buying, but trade prices still rank the methods (shown as "trade value").
  const league = (args.league ?? profile.league ?? "").replace(/^ssf\s+/i, "");
  if (!league) notes.push("No league in the profile: prices and the buy check are skipped (profile { league }).");
  const r = await rates(league, notes);
  const price = (name: string) => r.get(name);

  const L: string[] = [];
  L.push(`Craft plan: ${pool.base} (${pool.class}), item level ${pool.ilvl}${args.ilvl ? "" : " (assumed: say ilvl to change)"}; ${ssf ? "SSF: drops only" : `prices: poe.ninja ${league || "-"}`}`);
  L.push("Target:", ...wants.map((w) => `- ${wantRule(w)}`));
  if (missing.length) {
    L.push(`Cannot roll on this base at item level ${pool.ilvl}: ${missing.join(", ")}.`);
    const infl: string[] = [];
    for (const inf of ["shaper", "elder", "crusader", "eyrie", "basilisk", "adjudicator"]) {
      try {
        const p2 = (await link.call("craft_pool", { ...poolArgs, influence: inf })).result as Pool;
        if (unmatched(p2.mods, wants).length < missing.length) infl.push(inf);
      } catch { /* not every base has influence */ }
    }
    const NAMES: Record<string, string> = { eyrie: "Redeemer", basilisk: "Hunter", adjudicator: "Warlord" };
    L.push(infl.length ? `They can roll on influenced ${pool.base} bases: ${infl.map((x) => NAMES[x] ?? x[0].toUpperCase() + x.slice(1)).join(", ")} (PoB data). Use affixes { craft, base, ... } on such a base, or drop that want.` : "No influence adds them either: drop that want or pick another base (base).");
    return { text: L.join("\n") };
  }
  const bench = benchOptions(pool.bench, wants);
  const units = unitsOf(wants);

  const methods: Method[] = [];
  const am = altMethod(pool, hits, wants, bench, price);
  if (am) methods.push(am);
  const chaos = rareMethod("Chaos Orb spam", pool, hits, wants, bench, "Chaos Orbs", 1);
  if (chaos) methods.push(chaos);
  // Essences: the best two that guarantee one of the wants.
  const ePrices = await essencePrices(league);
  const ess: Array<{ line: PoolLine; h: Hits[number]; price?: number }> = [];
  for (const e of pool.essences) {
    if (e.level > pool.ilvl) continue;
    const h = wants.flatMap((w, wi) => w.alts.map((a, ai) => ({ want: wi, alt: ai, share: share(e.lines, a, w, true) }))).filter((x) => x.share > 0);
    if (h.length) ess.push({ line: e, h, price: e.name ? ePrices.get(e.name) : undefined });
  }
  ess.sort((a, b) => (b.h[0].share - a.h[0].share) || ((a.price ?? 1e9) - (b.price ?? 1e9)) || ((b.line.tier ?? 0) - (a.line.tier ?? 0)));
  const seen = new Set<string>();
  for (const e of ess) {
    const key = `${e.h[0].want}:${e.h[0].alt}`;
    if (seen.has(key) || seen.size >= 2) continue;
    seen.add(key);
    const m = rareMethod(`${e.line.name}`, pool, hits, wants, bench, e.line.name ?? "essences", e.price, { line: e.line, hits: e.h });
    if (m) methods.push(m);
  }
  const allPriced = methods.every((m) => m.cost.mid !== undefined);
  if (!allPriced && methods.length > 1) notes.push("Some prices are unknown: methods are ranked by chance per try, not by cost.");
  methods.sort((a, b) => (allPriced ? a.cost.mid! - b.cost.mid! : b.pTry - a.pTry));

  const budget = (() => {
    const cur = profile.currency;
    const chaosOnHand = (cur?.chaos ?? 0) + (cur?.divine ?? 0) * (price("Divine Orb") ?? 0);
    return chaosOnHand > 0 ? chaosOnHand : undefined;
  })();

  if (!methods.length) L.push("No computed method reaches every want together (the odds round to 0). Split the target, use meta-crafting, or buy.");
  methods.slice(0, 4).forEach((m, i) => {
    const range = `${c(m.cost.low)}-${c(m.cost.high)}`;
    const cost = m.cost.mid === undefined ? `expected ${m.orbs}` : ssf ? `expected ${m.orbs} (trade value ~${c(m.cost.mid)}, for comparison)` : `expected ~${c(m.cost.mid)} (range ${range}): ${m.orbs}`;
    L.push("", `${i + 1}. ${m.name}: ${cost}; risk ${m.risk}${ssf ? `; SSF: ${m.ssf}` : ""}`);
    m.steps.forEach((s, k) => L.push(`   ${k + 1}) ${s}`));
    if (i === 0) L.push(`   ${stopLine(m.pTry, ssf ? undefined : m.tryCost, m.tryName, ssf ? undefined : budget)}`);
  });

  const sim = await simulateTarget(ctx, pool, wants, args.slot, focus).catch((e) => ({ note: `Simulation: ${e instanceof Error ? e.message : String(e)}` }));
  if (sim && "ev" in sim && sim.ev) {
    const ev = sim.ev;
    L.push("", `Finished item in ${args.slot} (average rolls, PoB): DPS ${ev.dpsPct >= 0 ? "+" : ""}${ev.dpsPct.toFixed(1)}% | EHP ${ev.ehpPct >= 0 ? "+" : ""}${ev.ehpPct.toFixed(1)}%${ev.resNotes.length ? ` | ${ev.resNotes.join(", ")}` : ""}${ev.warnings.length ? ` | ${ev.warnings.join(", ")}` : ""} vs ${sim.current ?? "the empty slot"}.`);
    if (ev.score <= 0.5) L.push("   Worse than the item you wear: it lacks stats your current item gives (see the drops above). Add them to the wants, or keep the current item.");
  } else if (sim && "note" in sim) L.push("", sim.note!);

  let buyChaos: number | undefined;
  if (!ssf && league) {
    const buy = await buyCheck(ctx, pool, wants, league, r, args.slot);
    if (buy && "fair" in buy && buy.fair) {
      buyChaos = buy.fair.low;
      const best = methods[0]?.cost.mid;
      const verdict = best === undefined ? "" : best < buy.fair.low * 0.8 ? " -> crafting is cheaper on average." : best > buy.fair.low * 1.2 ? " -> buying is cheaper (crafting can still get lucky)." : " -> about the same: buy for certainty.";
      L.push("", `Buy instead: ${buy.total} instant-buyout listings with all wants; cheapest fair ~${c(buy.fair.low)} (median ${c(buy.fair.fair)}; ${buy.fair.note})${verdict}`, `   ${buy.url}${buy.sim ? `\n   ${buy.sim}` : ""}`);
    } else if (buy && "note" in buy) L.push("", buy.note + ("url" in buy && buy.url ? ` ${buy.url}` : ""));
  }
  if (profile.playMode === "mixed") L.push("", "[SSF] every method above uses drops only; [Trade] the buy line is the alternative.");
  L.push("", ...otherMethods(pool, wants, units));
  const used = [...new Set(methods.slice(0, 4).flatMap((m) => m.facts))];
  const unknown = [...new Set(methods.slice(0, 4).flatMap((m) => m.notes)), UNKNOWN.rollSpread];
  L.push("", "Sources (rules the odds rest on):", ...used.map((id) => `- ${cite(id)}`), `- Mod pool, spawn weights, tiers, essences, bench: ${(pool as unknown as { source?: string }).source ?? "PoB data"}.`);
  L.push("Unknown or assumed:", ...unknown.map((u) => `- ${u}`));
  if (notes.length) L.push("Notes:", ...notes.map((x) => `- ${x}`));
  L.push("Nothing was crafted or bought: you do each step in game.");
  return { text: L.join("\n"), best: methods[0], buyChaos };
}

export { FACTS };
