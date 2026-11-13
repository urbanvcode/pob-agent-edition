/**
 * "Close enough" item targets (Stage 11). Exact rares are almost never for sale,
 * so every rare in the build becomes a target: the stats that matter (each mod
 * line's worth simulated in PoB by taking it away), must-have / nice-to-have
 * with acceptable ranges, an instant-buyout search for items that meet the
 * must-haves with every listing simulated ("92% of the target for 15c"), and a
 * "craft it" option (Stage 6). Uniques get a "good enough roll" per ranged line.
 */
import fs from "fs";
import path from "path";
import { craftPlan } from "../craft/plan.js";
import { n } from "../format.js";
import { cacheDir } from "../paths.js";
import { getPoeSessionId, getProfile } from "../profile.js";
import type { Context } from "../registry.js";
import { priceInChaos, tradeItemToPoBText } from "../trade/itemText.js";
import type { TradeQuery } from "../trade/types.js";
import { evaluateCandidate, INSTANT_BUYOUT, isStop, ratesOrChaosOnly, tradeUrl, type TestStats } from "../trade/upgrades.js";

type Focus = "balanced" | "dps" | "defence";

/** Advisor rules (labelled in the output): a must-have may be 25% below the target's roll, a nice-to-have 50%. */
export const MUST_SHARE = 0.75, NICE_SHARE = 0.5, MUST_COVER = 0.7;

const dps = (s: TestStats) => ((s.FullDPS ?? 0) > 0 ? s.FullDPS! : s.CombinedDPS ?? s.TotalDPS ?? 0);
const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);

/**
 * Worth of an item over the plain base, in "score points": DPS% and EHP%
 * (weighted by focus) plus resistance points closer to the cap; a new unmet
 * attribute requirement counts against it.
 */
export function worth(base: TestStats, x: TestStats, focus: Focus): number {
  const w = focus === "dps" ? [1, 0.15] : focus === "defence" ? [0.15, 1] : [1, 0.6];
  let v = pct(dps(x), dps(base)) * w[0] + pct(x.TotalEHP ?? 0, base.TotalEHP ?? 0) * w[1];
  for (const k of ["Fire", "Cold", "Lightning"]) v += ((base[`Missing${k}Resist`] ?? 0) - (x[`Missing${k}Resist`] ?? 0)) * 0.5;
  v += ((base.MissingChaosResist ?? 0) - (x.MissingChaosResist ?? 0)) * 0.15;
  for (const [a, r] of [["Str", "ReqStr"], ["Dex", "ReqDex"], ["Int", "ReqInt"]]) {
    const short = (x[r] ?? 0) - (x[a] ?? 0);
    if (short > 0 && short > (base[r] ?? 0) - (base[a] ?? 0)) v -= 10;
  }
  return Number.isFinite(v) ? v : 0;
}

// --- mod lines -> searchable stats ---------------------------------------------------
const PSEUDO: Record<string, string> = {
  life: "pseudo.pseudo_total_life", es: "pseudo.pseudo_total_energy_shield", mana: "pseudo.pseudo_total_mana",
  fire: "pseudo.pseudo_total_fire_resistance", cold: "pseudo.pseudo_total_cold_resistance",
  lightning: "pseudo.pseudo_total_lightning_resistance", chaos: "pseudo.pseudo_total_chaos_resistance",
  strength: "pseudo.pseudo_total_strength", dexterity: "pseudo.pseudo_total_dexterity", intelligence: "pseudo.pseudo_total_intelligence",
};
const LABEL: Record<string, string> = {
  life: "+# to maximum Life (total)", es: "+# to maximum Energy Shield (total)", mana: "+# to maximum Mana (total)",
  fire: "+#% Fire Resistance (total)", cold: "+#% Cold Resistance (total)", lightning: "+#% Lightning Resistance (total)",
  chaos: "+#% Chaos Resistance (total)", strength: "+# Strength (total)", dexterity: "+# Dexterity (total)", intelligence: "+# Intelligence (total)",
};

/** Pseudo totals a line adds to (resistances, life, attributes), with the amount each. */
export function pseudoParts(line: string): Array<[string, number]> {
  const t = line.trim();
  let m: RegExpExecArray | null;
  if ((m = /^\+(\d+) to maximum (Life|Mana|Energy Shield)$/i.exec(t))) return [[{ life: "life", mana: "mana", "energy shield": "es" }[m[2].toLowerCase()]!, +m[1]]];
  if ((m = /^\+(\d+)% to all Elemental Resistances$/i.exec(t))) return ["fire", "cold", "lightning"].map((k) => [k, +m![1]]);
  if ((m = /^\+(\d+)% to (Fire|Cold|Lightning|Chaos) Resistance$/i.exec(t))) return [[m[2].toLowerCase(), +m[1]]];
  if ((m = /^\+(\d+)% to (Fire|Cold|Lightning|Chaos) and (Fire|Cold|Lightning|Chaos) Resistances$/i.exec(t))) return [[m[2].toLowerCase(), +m[1]], [m[3].toLowerCase(), +m[1]]];
  if ((m = /^\+(\d+) to all Attributes$/i.exec(t))) return ["strength", "dexterity", "intelligence"].map((k) => [k, +m![1]]);
  if ((m = /^\+(\d+) to (Strength|Dexterity|Intelligence)$/i.exec(t))) return [[m[2].toLowerCase(), +m[1]]];
  if ((m = /^\+(\d+) to (Strength|Dexterity|Intelligence) and (Strength|Dexterity|Intelligence)$/i.exec(t))) return [[m[2].toLowerCase(), +m[1]], [m[3].toLowerCase(), +m[1]]];
  return [];
}

/** The number a trade filter compares: the roll, or the average of "Adds # to #". */
export function lineAmount(line: string): number | undefined {
  const nums = [...line.matchAll(/(\d+(?:\.\d+)?)/g)].map((x) => +x[1]);
  if (!nums.length) return undefined;
  return /^Adds \d/i.test(line) && nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0];
}

export interface RawLine { text: string; implicit?: boolean; crafted?: boolean; unsupported?: boolean; tradeId?: string; without?: TestStats }
export interface RawTarget {
  slot: string; kind: "rare" | "unique"; name: string; baseName?: string; category?: string; ilvl?: number; itemText?: string;
  target?: TestStats; plain?: TestStats; now?: TestStats; error?: string;
  lines: Array<RawLine & { now?: string; low?: string; high?: string; lowStats?: TestStats; highStats?: TestStats }>;
}

export interface Want { key: string; id?: string; label: string; amount: number; min: number; value: number; share: number; implicit: boolean }
export interface Target { slot: string; name: string; baseName?: string; category?: string; worth: number; must: Want[]; nice: Want[]; base: Want[]; unsearchable: string[]; itemText?: string }

/** The lowest acceptable roll: a share of the target's, but small numbers (+1 gem level) must match. */
export const minOf = (amount: number, share: number) => (amount <= 3 ? amount : Math.floor(amount * share));

/** Ranks a rare's stats by simulated worth and splits them into must-have and nice-to-have. */
export function makeTarget(raw: RawTarget, focus: Focus): Target | undefined {
  if (!raw.target || !raw.plain) return undefined;
  const total = worth(raw.plain, raw.target, focus);
  const groups = new Map<string, Want>();
  const unsearchable: string[] = [];
  for (const l of raw.lines) {
    if (!l.without) continue;
    const value = Math.max(0, total - worth(raw.plain, l.without, focus));
    const parts = pseudoParts(l.text);
    const add = (key: string, id: string | undefined, label: string, amount: number, v: number) => {
      const g = groups.get(key) ?? { key, id, label, amount: 0, min: 0, value: 0, share: 0, implicit: true };
      g.amount += amount;
      g.value += v;
      g.implicit = g.implicit && !!l.implicit;
      groups.set(key, g);
    };
    if (parts.length) for (const [k, a] of parts) add(k, PSEUDO[k], LABEL[k], a, value / parts.length);
    else if (l.tradeId && lineAmount(l.text) !== undefined) add(l.tradeId, l.implicit ? l.tradeId.replace(/^explicit\./, "implicit.") : l.tradeId, l.text.replace(/\d+(?:\.\d+)?/g, "#"), lineAmount(l.text)!, value);
    else if (value > 0) unsearchable.push(`${l.text}${l.unsupported ? " (PoB does not model it)" : ""}`);
  }
  const all = [...groups.values()].filter((g) => g.value > 0.05).sort((a, b) => b.value - a.value);
  const sum = all.reduce((s, g) => s + g.value, 0) || 1;
  for (const g of all) g.share = g.value / sum;
  const searchable = all.filter((g) => !g.implicit);
  const must: Want[] = [], nice: Want[] = [];
  let cover = 0;
  for (const g of searchable) {
    if (must.length < 4 && (cover < MUST_COVER || !must.length)) { g.min = minOf(g.amount, MUST_SHARE); must.push(g); cover += g.share; }
    else if (nice.length < 4 && g.share >= 0.05) { g.min = minOf(g.amount, NICE_SHARE); nice.push(g); }
  }
  return { slot: raw.slot, name: raw.name, baseName: raw.baseName, category: raw.category, worth: total, must, nice, base: all.filter((g) => g.implicit), unsearchable, itemText: raw.itemText };
}

/** "and" search for the must-haves (or "at least n-1 of them" when relaxed), instant buyout, cheapest first. */
export function targetQuery(t: Target, relaxed: boolean, maxPrice?: number): TradeQuery {
  const filters = t.must.filter((w) => w.id).map((w) => ({ id: w.id!, value: { min: w.min } }));
  const stats = relaxed && filters.length >= 2 ? [{ type: "count", value: { min: filters.length - 1 }, filters }] : [{ type: "and", filters }];
  const q: TradeQuery = {
    query: {
      status: { option: INSTANT_BUYOUT },
      stats,
      filters: { type_filters: { filters: { ...(t.category ? { category: { option: t.category } } : {}), rarity: { option: "nonunique" } } } },
    },
    sort: { price: "asc" },
  } as TradeQuery;
  if (maxPrice) (q.query.filters as any).trade_filters = { filters: { price: { max: maxPrice } } };
  return q;
}

export interface Close { name: string; chaos: number; priceText: string; closeness: number; dpsPct: number; ehpPct: number; warnings: string[]; url: string }

/** A unique's ranged line: "any roll" or the roll that loses at most 1% DPS/EHP against a perfect one. */
export function rollAdvice(line: RawTarget["lines"][number], focus: Focus): string | undefined {
  if (!line.lowStats || !line.highStats || !line.low || !line.high) return undefined;
  const ev = evaluateCandidate(line.highStats, line.lowStats, focus);
  const spread = Math.max(Math.abs(ev.dpsPct), Math.abs(ev.ehpPct));
  const lo = lineAmount(line.low), hi = lineAmount(line.high);
  const what = `${line.text}: lowest roll ${ev.dpsPct.toFixed(1)}% DPS, ${ev.ehpPct.toFixed(1)}% EHP vs the highest`;
  if (spread < 2 || lo === undefined || hi === undefined) return `${what} -> any roll is fine (now ${line.now}).`;
  const r = Math.min(1, Math.max(0, 1 - 1 / spread));
  const good = lo + (hi - lo) * r;
  const shown = Math.abs(hi) < 10 ? Math.round(good * 10) / 10 : Math.ceil(good);
  return `${what} -> good enough: ${shown} or more (loses at most 1%; now ${line.now}).`;
}

// --- cache of the last targets per build (cost per stage uses the cheapest close listing) ----
const cacheFile = (build: string) => path.join(cacheDir("create"), `targets-${build.replace(/[^\w.-]+/g, "_").slice(0, 80)}.json`);
export interface TargetCache { at: number; league: string; slots: Record<string, { chaos: number; closeness: number; name: string }> }
export function readTargetCache(build: string): TargetCache | undefined {
  try { return JSON.parse(fs.readFileSync(cacheFile(build), "utf8")); } catch { return undefined; }
}
function writeTargetCache(build: string, c: TargetCache) {
  try { fs.writeFileSync(cacheFile(build), JSON.stringify(c)); } catch { /* cache only */ }
}

const CRAFT_WORDS: Record<string, string> = {
  life: "life", es: "maximum energy shield", mana: "maximum mana", fire: "fire resistance", cold: "cold resistance",
  lightning: "lightning resistance", chaos: "chaos resistance", strength: "strength", dexterity: "dexterity", intelligence: "intelligence",
};
/** The must-haves in the crafting helper's words ("lightning resistance 30+, life 58+"). */
export function craftWants(t: Target): string {
  return t.must.map((w) => `${CRAFT_WORDS[w.key] ?? w.label} ${n(w.min)}+`).join(", ");
}

const chaosText = (c: number) => (c < 1 ? c.toFixed(1) : n(Math.round(c)));
const wantText = (w: Want) => `${w.label.replace("#", n(w.min) + "+")} [worth ${Math.round(w.share * 100)}%, target ${n(Math.round(w.amount))}]`;

/** The targets text for the open build. */
export async function targetsText(ctx: Context, a: { league: string; leagueNote?: string; slot?: string; limit?: number; budget?: number }): Promise<string> {
  const profile = getProfile().profile;
  const focus: Focus = profile.hardcore ? "defence" : profile.preferences.defence === "tanky" ? "defence" : profile.preferences.defence === "glass" ? "dps" : "balanced";
  const ssf = profile.playMode === "ssf";
  const link = await ctx.pob.link();
  const raw = (await link.call("create_targets", { slots: a.slot ? [a.slot] : [] })).result as RawTarget[];
  if (!raw.length) return a.slot ? `${a.slot}: no rare or unique item equipped.` : "No rare or unique items equipped.";
  const ks = await link.call("key_stats").catch(() => null);
  const build = String(ks?.name ?? "build");
  const L: string[] = [`Item targets for ${build} (every number simulated in PoB; focus ${focus}${ks?.assumptions ? `; config: ${ks.assumptions}` : ""}).`,
    `Rules (advisor rules, not game facts): must-haves cover ~${MUST_COVER * 100}% of what the item is worth and may be ${Math.round((1 - MUST_SHARE) * 100)}% below its roll; nice-to-haves ${Math.round((1 - NICE_SHARE) * 100)}% below. "x% of the target" = the listing's simulated worth over a plain base / the target's.`];
  const targets = raw.filter((r) => r.kind === "rare").map((r) => ({ raw: r, t: makeTarget(r, focus) })).sort((x, y) => (y.t?.worth ?? 0) - (x.t?.worth ?? 0));
  const searchN = ssf ? 0 : Math.min(Math.max(a.limit ?? 3, 1), 5);
  const notes: string[] = [];
  const rates = searchN ? await ratesOrChaosOnly(a.league, notes) : new Map<string, number>();
  const cache: TargetCache = { at: Date.now(), league: a.league, slots: readTargetCache(build)?.slots ?? {} };
  let searched = 0, stopped = false;

  for (const { raw: r, t } of targets) {
    L.push("", `${r.slot}: ${r.name} (${r.baseName ?? "?"})${t ? ` - worth ${t.worth.toFixed(1)} points over a plain base` : ""}`);
    if (!t) { L.push(`   ${r.error ?? "PoB could not simulate it."}`); continue; }
    L.push(`   Must have: ${t.must.map(wantText).join(" | ") || "nothing searchable"}`);
    if (t.nice.length) L.push(`   Nice to have: ${t.nice.map(wantText).join(" | ")}`);
    if (t.base.length) L.push(`   From the base (implicit): ${t.base.map((w) => w.label.replace("#", n(Math.round(w.amount)))).join(", ")}`);
    if (t.unsearchable.length) L.push(`   Not searchable: ${t.unsearchable.join("; ")}`);
    if (ssf) { L.push(`   [SSF] keep a drop with the must-haves; craft it: affixes { craft: "${craftWants(t)}", slot: "${r.slot}" }`); continue; }
    if (stopped || searched >= searchN || !t.must.some((w) => w.id)) {
      L.push(`   Search: build_create { targets: true, slot: "${r.slot}" }`);
      continue;
    }
    searched++;
    try {
      let search = await ctx.trade.searchItems(a.league, targetQuery(t, false, a.budget));
      let relaxed = false;
      if ((search.result?.length ?? 0) < 3 && t.must.filter((w) => w.id).length >= 2) {
        search = await ctx.trade.searchItems(a.league, targetQuery(t, true, a.budget));
        relaxed = true;
      }
      if (!search.result?.length) { L.push(`   [Trade] no instant-buyout listing has the must-haves${a.budget ? ` under ${n(a.budget)}c` : ""}.`); }
      else {
        const listings = await ctx.trade.fetchItems(search.result.slice(0, 8), search.id);
        const usable = listings.map((l) => ({ l, chaos: priceInChaos(l.listing.price, rates) })).filter((x) => x.chaos !== undefined) as Array<{ l: typeof listings[number]; chaos: number }>;
        const texts = usable.map((x) => tradeItemToPoBText(x.l.item));
        const rep = texts.length ? (await link.call("test_items", { slot: r.slot, items: texts })).result : { results: [] };
        const close: Close[] = [];
        (rep.results as Array<{ ok: boolean; stats?: TestStats }>).forEach((res, i) => {
          if (!res.ok || !res.stats) return;
          const ev = evaluateCandidate(r.target!, res.stats, focus);
          const price = usable[i].l.listing.price!;
          close.push({ name: [usable[i].l.item.name, usable[i].l.item.typeLine].filter(Boolean).join(", "), chaos: usable[i].chaos, priceText: `${price.amount} ${price.currency}`,
            closeness: t.worth > 0 ? worth(r.plain!, res.stats, focus) / t.worth : 0, dpsPct: ev.dpsPct, ehpPct: ev.ehpPct, warnings: ev.warnings, url: tradeUrl(a.league, search.id, usable[i].l.id) });
        });
        close.sort((x, y) => y.closeness - x.closeness);
        L.push(`   [Trade] ${search.total ?? search.result.length} instant-buyout listings ${relaxed ? `with ${t.must.length - 1} of the ${t.must.length} must-haves` : "with every must-have"}; the cheapest ${close.length} simulated:`);
        for (const c of close.slice(0, 4)) {
          L.push(`   - ${Math.round(c.closeness * 100)}% of the target for ${c.priceText} (~${chaosText(c.chaos)}c): ${c.name}; vs the target DPS ${c.dpsPct >= 0 ? "+" : ""}${c.dpsPct.toFixed(1)}%, EHP ${c.ehpPct >= 0 ? "+" : ""}${c.ehpPct.toFixed(1)}%${c.warnings.length ? ` (${c.warnings.join(", ")})` : ""}`, `     ${c.url}`);
        }
        const best = close.filter((c) => c.closeness >= 0.8).sort((x, y) => x.chaos - y.chaos)[0] ?? close[0];
        if (best) cache.slots[r.slot] = { chaos: best.chaos, closeness: best.closeness, name: best.name };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      L.push(`   [Trade] ${msg}`);
      if (isStop(msg)) stopped = true;
    }
    const wants = craftWants(t);
    if (a.slot && wants) {
      const craft = await craftPlan(ctx, { craft: wants, slot: r.slot, league: a.league, noBuy: true }).catch(() => undefined);
      const best = craft?.best;
      L.push(best ? `   Craft it (the must-haves): ${best.name}${best.cost.mid !== undefined ? `, expected ~${n(Math.round(best.cost.mid))}c` : ""} (${best.orbs}); steps: affixes { craft: "${wants}", slot: "${r.slot}" }.` : `   Craft it: no computed method reaches all must-haves; affixes { craft: "${wants}", slot: "${r.slot}" } lists the options.`);
    } else if (wants) L.push(`   Craft it: affixes { craft: "${wants}", slot: "${r.slot}" }`);
  }

  const uniques = raw.filter((r) => r.kind === "unique" && r.lines.length);
  if (uniques.length) {
    L.push("", "Uniques with variable rolls (each line simulated at its lowest and highest roll; between them taken as linear):");
    for (const u of uniques) for (const line of u.lines) {
      const adv = rollAdvice(line, focus);
      if (adv) L.push(`- ${u.slot} ${u.name}: ${adv}`);
    }
  }
  if (!ssf) {
    writeTargetCache(build, cache);
    L.push("", `Prices: league ${a.league}, checked ${new Date(cache.at).toISOString().slice(0, 16).replace("T", " ")} UTC; instant buyout only, the player buys from the link.${a.leagueNote ? ` ${a.leagueNote}` : ""}`);
    if (!getPoeSessionId()) L.push("Trade site not logged in: plain stat searches only (no weighted search); every listing is still simulated in PoB.");
  }
  if (profile.playMode === "mixed") L.push("[SSF] alternative: keep a drop with the must-haves, or craft it (the affixes line per slot).");
  L.push(...notes);
  return L.join("\n");
}
