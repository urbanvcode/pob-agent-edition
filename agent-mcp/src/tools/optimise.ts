/**
 * Stage 4 optimiser: one tool for goal-based min-maxing. The PoB side
 * (PathOfBuilding/src/Agent/Handlers/Optimise.lua) sets temporary config for the
 * goal, simulates every lever and ranks by gain per cost; this file formats the
 * result, tags each suggestion with the mechanic behind it, explains mechanics
 * at the profile's explanation mode (glossary, cited) and fills the Advisor tabs.
 * Gear comes from plan_upgrades (Stage 5 hook: budget_chaos).
 */
import { findGlossary, wikiUrl, type GlossaryEntry } from "../knowledge/glossary.js";
import { n, pct } from "../format.js";
import { getProfile } from "../profile.js";
import { S, tool, type Context, type Tool } from "../registry.js";

export const GOALS = ["bossing", "clear", "tankiness", "balanced", "weakest"] as const;
export const LEVERS = ["passives", "respec", "gems", "auras", "flasks", "anoint", "pantheon", "config", "scaling"] as const;

// Stat text -> glossary term (the mechanic that makes the change work). First match wins per term.
const MECHANICS: Array<[RegExp, string]> = [
  [/critical/i, "Critical strike"],
  [/penetrat/i, "Penetration"],
  [/exposure/i, "Exposure"],
  [/converted|gained as/i, "Damage conversion"],
  [/over time|dot multiplier/i, "Damage over time"],
  [/ignite/i, "Ignite"], [/bleed/i, "Bleeding"], [/poison/i, "Poison"],
  [/shock/i, "Shock"], [/freez|chill/i, "Freeze"], [/stun/i, "Stun"],
  [/resistance/i, "Resistance cap"],
  [/suppress/i, "Spell Suppression"], [/\bblock\b/i, "Block"], [/evasion/i, "Evasion"], [/armour/i, "Armour"],
  [/energy shield/i, "Energy Shield"], [/leech/i, "Leech"], [/reserv/i, "Reservation"], [/accuracy/i, "Accuracy"],
  [/power charge|frenzy charge|endurance charge/i, "Endurance, Frenzy and Power charges"],
  [/onslaught/i, "Onslaught"], [/fortif/i, "Fortify"], [/curse/i, "Curse"], [/minion/i, "Minion"],
  [/low life|full life/i, "Low Life and Full Life"],
  [/\b(more|less|increased|reduced)\b/i, "More and increased"],
];

/** Up to three mechanic tags for a suggestion: the lever's own, then what its stat text names. */
export function mechanicTags(s: { mechanic?: string; text?: string; stats?: string[]; kind?: string; lever?: string }): string[] {
  const tags: string[] = [];
  const push = (t?: string) => { if (t && !tags.includes(t) && tags.length < 3) tags.push(t); };
  if (s.kind === "Keystone") push("Keystone");
  push(s.mechanic);
  const text = [...(Array.isArray(s.stats) ? s.stats : []), s.lever === "respec" ? "" : s.text ?? ""].join(" ");
  for (const [re, term] of MECHANICS) if (re.test(text)) push(term);
  return tags;
}

type Gain = { stPct: number; dpsPct: number; ehpPct: number; hitPct: number; msPct: number; areaPct: number; life: number; res?: Record<string, number> };

function gainText(g: Gain, goal: string): string {
  const parts: string[] = [];
  if (goal === "bossing" || Math.abs(g.stPct - g.dpsPct) > 0.1) parts.push(`single-target DPS ${pct(g.stPct)}`);
  if (goal !== "bossing") parts.push(`DPS ${pct(g.dpsPct)}`);
  parts.push(`EHP ${pct(g.ehpPct)}`, `max hit ${pct(g.hitPct)}`);
  if (Math.abs(g.msPct) >= 0.1) parts.push(`move speed ${pct(g.msPct)}`);
  if (Math.abs(g.areaPct) >= 0.1) parts.push(`area ${pct(g.areaPct)}`);
  if (Math.abs(g.life) >= 1) parts.push(`life ${g.life > 0 ? "+" : ""}${Math.round(g.life)}`);
  const res = Object.entries(g.res && !Array.isArray(g.res) ? g.res : {}).map(([k, v]) => `${k} res ${v > 0 ? "+" : ""}${Math.round(v)}`);
  return [...parts, ...res].join(" | ");
}

/** Before -> after of the number the goal cares most about. */
export function afterText(g: Gain, goal: string, b: any): string {
  const [label, before, p] = goal === "bossing" ? ["single-target DPS", b.singleTargetDps, g.stPct]
    : goal === "tankiness" ? ["EHP", b.ehp, g.ehpPct] : ["DPS", b.dps, g.dpsPct];
  if (!(before > 0) || Math.abs(p) < 0.05) return "";
  return ` (${label} ${n(before)} -> ${n(before * (1 + p / 100))})`;
}

function costText(s: any): string {
  const c = s.cost ?? {};
  if (c.regret) return `${c.regret} Orb${c.regret === 1 ? "" : "s"} of Regret`;
  if (c.points) return `${c.points} point${c.points === 1 ? "" : "s"}${c.free ? " (unspent points cover it)" : ""}`;
  if (c.buy) return `buy: ${c.count ? `${c.count}x ` : ""}${c.buy}${c.awakened ? " (awakened: expensive)" : ""}${c.note ? `; ${c.note}` : ""}`;
  return c.note ?? "one change";
}

/** Cost label short enough for the Advisor card. */
export function shortCost(s: any): string {
  const c = s.cost ?? {};
  if (c.regret) return `${c.regret} regret`;
  if (c.points) return `${c.points} pt${c.points === 1 ? "" : "s"}`;
  if (c.buy) return c.awakened ? "buy (awakened)" : s.lever === "anoint" ? "oils" : "buy";
  return s.lever === "pantheon" ? "switch" : s.lever === "bandit" ? "Act 2" : "change";
}

const TAB: Record<string,"Passives" | "Gems" | "Other"> = { passive: "Passives", mastery: "Passives", respec: "Passives", gem: "Gems", "gem level": "Gems", "gem quality": "Gems", aura: "Gems", herald: "Gems", curse: "Gems" };
const VIEW: Record<string, string> = { Passives: "TREE", Gems: "SKILLS", Other: "CONFIG" };

/** Glossary lines for the mechanics the profile's explanation mode wants explained. */
export function explanations(tags: string[], mode: string, learned: string[]): string[] {
  if (mode === "concise") return [];
  const known = new Set(learned.map((t) => t.toLowerCase()));
  const out: string[] = [];
  const done = new Set<string>();
  for (const tag of tags) {
    const e: GlossaryEntry | undefined = findGlossary(tag);
    if (!e || done.has(e.term)) continue;
    if (mode === "teach" && (known.has(e.term.toLowerCase()) || (e.aliases ?? []).some((a) => known.has(a.toLowerCase())))) continue;
    done.add(e.term);
    out.push(`- ${e.term}: ${e.text}${e.poe2 ? ` PoE2: ${e.poe2.text}` : ""} [poewiki "${e.page}", ${e.version}: ${wikiUrl(e.page)}]`);
    if (out.length >= (mode === "deep" ? 5 : 3)) break;
  }
  return out;
}

function focusFor(goal: string): string {
  return goal === "tankiness" ? "defence" : goal === "bossing" || goal === "clear" ? "dps" : "balanced";
}

export function formatOptimise(r: any, mode: string, learned: string[]): { text: string; tags: string[] } {
  const L: string[] = [];
  const goal = String(r.goal);
  L.push(`Optimiser: ${r.goalLabel}${r.reason ? ` (fix weakest: ${r.reason})` : ""}; main skill ${r.mainSkill ?? "?"}; ${r.evaluated?.total ?? 0} options simulated in ${r.seconds ?? "?"} s`);
  L.push(`Metric: ${r.metric}`);
  const temp = r.tempConfig && !Array.isArray(r.tempConfig) ? Object.entries(r.tempConfig).map(([k, v]) => `${k} = ${v}`) : [];
  L.push(`Config for this run: ${temp.length ? `${temp.join(", ")} (temporary, restored afterwards)` : "the build's own"}; ${r.assumptions}`);
  const b = r.base ?? {};
  L.push(`Now: single-target DPS ${n(b.singleTargetDps)} | DPS ${n(b.dps)} | EHP ${n(b.ehp)} | weakest max hit ${n(b.weakestHit)} | life ${n(b.life)}${r.pointsFree > 0 ? ` | ${r.pointsFree} unspent passive point(s)` : ""}`);
  const list = (Array.isArray(r.suggestions) ? r.suggestions : []) as any[];
  const allTags: string[] = [];
  L.push("", `Ranked by gain per cost (a passive point, an Orb of Regret or one change each count 1; passives within ${r.maxPoints} points):`);
  if (!list.length) L.push("Nothing PoB can find improves this goal. Try another goal, more points, or gear (plan_upgrades).");
  list.forEach((s, i) => {
    const tags = mechanicTags(s);
    allTags.push(...tags);
    L.push(`${i + 1}. [${s.lever}] ${s.text} - ${costText(s)}: ${gainText(s.gain, goal)}${afterText(s.gain, goal, b)}${s.unusable ? " - NOT USABLE YET (attributes short)" : ""}`);
    const extra = [tags.length ? `mechanic: ${tags.join(", ")}` : "", Array.isArray(s.stats) && s.stats.length ? (s.stats as string[]).filter((x) => x.trim()).join("; ") : "", s.warning ? `warning: ${s.warning}` : ""].filter(Boolean);
    if (Array.isArray(s.sideEffects)) extra.push(`side effect: ${s.sideEffects.join("; ")}`);
    if (extra.length) L.push(`   ${extra.join(" | ")}`);
    if (Array.isArray(s.ops) && s.ops.length) L.push(`   what_if ops: ${JSON.stringify(s.ops)}`);
    else if (s.lever === "anoint") L.push(`   oils: ${(s.recipe ?? []).join(", ")} (edit, or suggest { kind: "anoint" })`);
  });
  if (r.more > 0) L.push(`(${r.more} more; raise limit)`);
  const under = (Array.isArray(r.undercount) ? r.undercount : []) as any[];
  if (under.length) {
    L.push("", "You may be under-counting (off in PoB, would raise this goal; set them only if they are true in your fights):");
    for (const u of under) L.push(`- ${u.text}${u.key ? ` [${u.key}]` : ""}: ${gainText(u.gain, goal)}${u.ops ? ` | ops: ${JSON.stringify(u.ops)}` : ""}`);
  }
  const unset = (Array.isArray(r.unsetCounts) ? r.unsetCounts : []) as any[];
  if (unset.length) L.push(`Also 0 in PoB (no value assumed, numbers may be low): ${unset.map((u) => `${u.skill}: ${u.label} [${u.var}]`).join("; ")}`);
  const blocked = (Array.isArray(r.blocked) ? r.blocked : []) as any[];
  if (blocked.length) L.push("", `Would help but cannot be used now: ${blocked.map((x) => `${x.name}${x.gain ? ` (${pct(x.gain.stPct)} ST DPS, ${pct(x.gain.ehpPct)} EHP)` : ""}: ${x.why}`).join("; ")}`);
  const scaling = (Array.isArray(r.scaling) ? r.scaling : []) as any[];
  if (scaling.length) {
    L.push("", "Scaling report (what one step of each stat is worth here, best first; tells you what to look for on gear and passives):");
    for (const x of scaling.filter((x: any) => Math.abs(x.score) >= 0.05).slice(0, 10)) L.push(`- ${x.stat}: ${gainText(x.gain, goal)}`);
  }
  const ex = explanations(allTags, mode, learned);
  if (ex.length) L.push("", `Mechanics (${mode} mode; explain these, then profile { learned }):`, ...ex);
  L.push("", "Try one with what_if (the ops above), apply with edit, then save_build under a new name. Jewels: suggest { kind: jewel }.");
  return { text: L.join("\n"), tags: allTags };
}

async function pushAdvisor(ctx: Context, r: any): Promise<boolean> {
  const link = await ctx.pob.link();
  if (link.kind !== "live") return false;
  const tabs: Record<string, any[]> = { Passives: [], Gems: [], Other: [] };
  for (const s of (r.suggestions ?? []) as any[]) {
    const tab = TAB[s.lever] ?? "Other";
    tabs[tab].push({ slot: s.lever, name: s.text, priceText: shortCost(s), costText: costText(s), dpsPct: r.goal === "bossing" ? s.gain.stPct : s.gain.dpsPct, ehpPct: s.gain.ehpPct,
      lifeDelta: s.gain.life, warnings: s.sideEffects ?? (s.warning ? [s.warning] : undefined), lines: [...(s.stats ?? []), ...mechanicTags(s).map((t) => `Mechanic: ${t}`)], view: VIEW[tab] });
  }
  for (const u of (r.undercount ?? []) as any[]) tabs.Other.push({ slot: "config?", name: `Under-counted? ${u.text}`, priceText: "if true", dpsPct: u.gain.stPct, ehpPct: u.gain.ehpPct, lifeDelta: u.gain.life, view: "CONFIG" });
  const first = TAB[(r.suggestions ?? [])[0]?.lever] ?? "Other";
  try {
    for (const [tab, items] of Object.entries(tabs)) await link.call("set_advisor", { tab, goal: r.goalLabel, time: Date.now(), items, select: tab === first });
    return true;
  } catch { return false; }
}

export function optimiseTools(planUpgrades?: Tool): Tool[] {
  return [
    tool("optimise", "Goal-based min-maxing simulated with the goal's config (restored after): passives within points (paths), respecs, masteries, gems, auras/curses, flasks, anoint, pantheon/bandit. Ranked by gain per cost with the mechanic, plus under-counted config and a scaling report. weakest: goal from diagnose; budget_chaos adds plan_upgrades.",
      { goal: S.enum([...GOALS]), points: S.num("default 6"), levers: S.list(S.enum([...LEVERS])), budget_chaos: S.num(), limit: S.num() }, [],
      async (ctx, args) => {
        const { profile } = getProfile();
        const link = await ctx.pob.link();
        const res = await link.call("optimise", {
          goal: GOALS.includes(args.goal) ? args.goal : "weakest", points: args.points, limit: args.limit,
          levers: Array.isArray(args.levers) ? args.levers.filter((l: string) => (LEVERS as readonly string[]).includes(l)) : undefined,
          hardcore: profile.hardcore,
        }, 300_000);
        const { text } = formatOptimise(res, profile.explanationMode, profile.learnedTopics);
        const parts = [text];
        if (res.rollbackProblem) parts.push(`WARNING: the build may not be exactly as before (${res.rollbackProblem}).`);
        if (await pushAdvisor(ctx, res).catch(() => false)) parts.push("Also in PoB Agent Edition > Overview > AI Advisor (Passives / Gems / Other tabs).");
        const focus = res.reason && /resist/.test(res.reason) ? "resists" : focusFor(String(res.goal));
        if (Number(args.budget_chaos) > 0 && planUpgrades) {
          // Stage 5: budget_chaos is the total for gear; the best set of buys is simulated together (SSF: rares to keep).
          const gear = focus !== "resists" ? { budget: Number(args.budget_chaos), focus }
            : profile.playMode === "ssf" ? { budget: Number(args.budget_chaos), focus: "defence" } : { budget_chaos: Number(args.budget_chaos), focus };
          try { parts.push("", "GEAR (plan_upgrades):", await planUpgrades.run(ctx, gear)); }
          catch (e) { parts.push("", `Gear search failed: ${e instanceof Error ? e.message : String(e)}`); }
        } else {
          parts.push("", profile.playMode === "ssf" ? "Gear (SSF): look for the stats at the top of the scaling report; suggest { kind: jewel } and affixes show what can roll." : `Gear: plan_upgrades { budget_chaos, focus: "${focus}" } (or call optimise with budget_chaos).`);
        }
        return parts.join("\n");
      }, { trade: true }),
  ];
}
