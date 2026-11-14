/**
 * Stage 8 build capability check: what content the build can do safely, from PoB's
 * own simulation (Lua farming_check: map boss at each area level, pinnacle/uber
 * presets, every map mod PoB models) against content facts from the cited data file
 * (area level per tier, Delirium and Simulacrum scaling, rare monster life).
 * The margins that count as "safe" are advisor rules (FARMING_DATA.rules), not game facts.
 */
import { n } from "../format.js";
import { FARMING_DATA as D } from "./data.js";

export interface Measure { dps: number; ehp?: number; maxHit?: number; maxHitType?: string; hits?: number; enemyDamage?: number; recovery?: number }
export interface TierRow { level: number; monsterLife?: number; clearDps: number; bossDps: number; hits?: number; packHits?: number; maxHit?: number; maxHitType?: string; enemyDamage?: number; ehp?: number; bossHit?: Record<string, number> }
export interface ModRow { name: string; kind: string; text: string; dpsPct?: number; bossDpsPct?: number; maxHitPct?: number; hitsPct?: number; ehpPct?: number; recoveryPct?: number }
export interface CheckResult {
  base: Measure; clear: Measure; tiers: TierRow[]; pinnacle: Measure; uber: Measure; mods: ModRow[];
  life?: number; energyShield?: number; resists?: Record<string, number>; level?: number; mainSkill?: string; assumptions?: string;
  /** The player's own enemy settings set aside for the check (custom hit damage, a boss skill preset, a fixed damage type). */
  overridden?: string[];
}

const TYPES = ["Physical", "Fire", "Cold", "Lightning", "Chaos"];
/** "23% physical, 23% fire, ..." of PoB's map boss hit (Standard Boss preset). */
export function hitMix(hit: Record<string, number> | undefined): string | undefined {
  const total = hit ? TYPES.reduce((a, t) => a + (hit[t] ?? 0), 0) : 0;
  if (!hit || !(total > 0)) return undefined;
  return TYPES.filter((t) => hit[t] > 0).map((t) => `${Math.round((hit[t] / total) * 100)}% ${t.toLowerCase()}`).join(", ");
}

export type Verdict = "safe" | "risky" | "unsafe";
export const MARK: Record<Verdict, string> = { safe: "OK", risky: "RISKY", unsafe: "NO" };

/** Area level of each map tier 1-16 (cited ranges: white 68-72, yellow 73-77, red 78-83). */
export function tierLevels(): Array<{ tier: number; level: number; color: string }> {
  const out: Array<{ tier: number; level: number; color: string }> = [];
  for (const r of D.facts.mapTiers) for (let t = r.tiers[0]; t <= r.tiers[1]; t++) out.push({ tier: t, level: r.areaLevel[0] + (t - r.tiers[0]), color: r.color });
  return out;
}

export function survival(hits: number | undefined, hardcore: boolean): Verdict {
  const R = D.rules;
  if (hits === undefined) return "risky";
  if (hits >= (hardcore ? R.hitsSafeHardcore : R.hitsSafe)) return "safe";
  return hits >= R.hitsRisky ? "risky" : "unsafe";
}

/** Rare monster life at an area level: PoB's base monster life table x the wiki's rare life multiplier (map mods and innate rare mods not included). */
export function rareLife(level: number, baseLife: number | undefined): number | undefined {
  const pct = (D.facts.rareLife.byLevel as Record<string, number>)[String(level)];
  return baseLife && pct !== undefined ? baseLife * (1 + pct / 100) : undefined;
}

export function killTime(life: number | undefined, dps: number): number | undefined {
  return life && dps > 0 ? life / dps : undefined;
}

export function clearVerdict(seconds: number | undefined): Verdict {
  if (seconds === undefined) return "risky";
  return seconds <= D.rules.rareKillComfortable ? "safe" : seconds <= D.rules.rareKillSlow ? "risky" : "unsafe";
}

export interface TierVerdict { tier: number; level: number; color: string; survive: Verdict; clear: Verdict; hits?: number; maxHit?: number; maxHitType?: string; rareKill?: number }

/** One verdict per map tier, interpolating PoB's rows to the nearest simulated level at or above. */
export function tierVerdicts(r: CheckResult, hardcore: boolean): TierVerdict[] {
  const rows = [...r.tiers].sort((a, b) => a.level - b.level);
  return tierLevels().map(({ tier, level, color }) => {
    const row = rows.find((x) => x.level >= level) ?? rows[rows.length - 1];
    const rare = killTime(rareLife(level, row?.monsterLife), row?.clearDps ?? 0);
    return { tier, level, color, survive: survival(row?.hits, hardcore), clear: clearVerdict(rare), hits: row?.hits, maxHit: row?.maxHit, maxHitType: row?.maxHitType, rareKill: rare };
  });
}

/** Highest tier the build is comfortable in (both survive and clear "safe"); 0 = not even white maps. */
export function comfortableTier(v: TierVerdict[]): number {
  let best = 0;
  for (const t of v) { if (t.survive === "safe" && t.clear !== "unsafe") best = t.tier; else break; }
  return best;
}

export function deliriumRows(r: CheckResult, hardcore: boolean) {
  const top = [...r.tiers].sort((a, b) => b.level - a.level)[0];
  const life = rareLife(top?.level ?? 83, top?.monsterLife);
  return D.facts.delirium.rows.map((row) => {
    const hits = top?.hits !== undefined ? top.hits / (1 + row.incDamage / 100) : undefined;
    const dps = (top?.clearDps ?? 0) * (1 - row.lessTakenRare / 100);
    const rare = killTime(life, dps);
    return { pct: row.pct, hits, rareKill: rare, survive: survival(hits, hardcore), clear: clearVerdict(rare) };
  });
}

/** Later Simulacrum waves: T16 numbers with 100% Delirium, 70% more damage and 360% more life on rares (cited). */
export function simulacrum(r: CheckResult, hardcore: boolean) {
  const sim = D.facts.simulacrum;
  const deli = D.facts.delirium.rows[D.facts.delirium.rows.length - 1];
  const top = [...r.tiers].sort((a, b) => b.level - a.level)[0];
  const hits = top?.hits !== undefined ? top.hits / ((1 + deli.incDamage / 100) * (1 + sim.damageMore / 100)) : undefined;
  const life = rareLife(top?.level ?? 83, top?.monsterLife);
  const rare = killTime(life !== undefined ? life * (1 + sim.lifeMore[0] / 100) : undefined, (top?.clearDps ?? 0) * (1 - deli.lessTakenRare / 100));
  return { hits, rareKill: rare, survive: survival(hits, hardcore), clear: clearVerdict(rare) };
}

/** Map mods that hurt this build most (PoB, one at a time at red-map values). */
export function modsToAvoid(mods: ModRow[], limit = 6): Array<ModRow & { worst: number; why: string }> {
  const out = mods.map((m) => {
    const parts: Array<[number, string]> = [
      [m.dpsPct ?? 0, "clear DPS"], [m.bossDpsPct ?? 0, "boss DPS"], [m.hitsPct ?? 0, "hits to die"],
      [m.maxHitPct ?? 0, "weakest max hit"], [m.recoveryPct ?? 0, "life/ES recovery"],
    ];
    const worst = Math.min(...parts.map((p) => p[0]));
    const why = parts.filter((p) => p[0] <= -1).sort((a, b) => a[0] - b[0]).slice(0, 2).map((p) => `${p[1]} ${p[0].toFixed(0)}%`).join(", ");
    return { ...m, worst, why };
  });
  return out.filter((m) => m.worst <= -D.rules.modHurtPct).sort((a, b) => a.worst - b.worst).slice(0, limit);
}

const secs = (s: number | undefined) => (s === undefined ? "?" : s < 0.1 ? "<0.1 s" : `${s.toFixed(s < 10 ? 1 : 0)} s`);
const hitsText = (h: number | undefined) => (h === undefined ? "?" : h.toFixed(1));

export function capabilityText(r: CheckResult, hardcore: boolean): { lines: string[]; tier: number; verdicts: TierVerdict[] } {
  const v = tierVerdicts(r, hardcore);
  const tier = comfortableTier(v);
  const pick = [1, 5, 6, 10, 11, 14, 16].map((t) => v.find((x) => x.tier === t)!).filter(Boolean);
  const rows = [...r.tiers].sort((a, b) => a.level - b.level);
  const low = rows[0], high = rows[rows.length - 1];
  const mix = hitMix(high?.bossHit);
  const weakest = rows.find((x) => x.maxHit !== undefined);
  const lines = [
    `1. WHAT THE BUILD CAN DO (PoB: a map boss at each area level for survival, normal packs for clear; ${r.mainSkill ?? "main skill"}, level ${r.level ?? "?"})`,
    `Map boss model: PoB's "Standard Boss", one average hit of ${n(low?.bossHit?.total)} (area level ${low?.level ?? "?"}) to ${n(high?.bossHit?.total)} (area level ${high?.level ?? "?"})${mix ? `, split ${mix}` : ""}. It stands for a boss's average attack, not one boss's real skill: a boss that hits with mostly one type is worse if that is your weak type.`,
    ...pick.map((t) => `- T${t.tier} (${t.color}, area level ${t.level}): survive ${MARK[t.survive]} (${hitsText(t.hits)} of those hits to kill you); clear ${MARK[t.clear]} (a rare dies in ${secs(t.rareKill)})`),
    ...(weakest ? [`- Weakest single-type max hit: ${n(weakest.maxHit)} ${weakest.maxHitType ?? ""} (the biggest hit of only that type you survive; not what the verdict above uses).`] : []),
    tier >= 16 ? "Verdict: comfortable in T16 maps."
      : tier > 0 ? `Verdict: comfortable up to T${tier}; T${tier + 1}+ needs more defence or damage first.`
      : `Verdict: not comfortable even in white maps by the advisor's margin (at least ${hardcore ? D.rules.hitsSafeHardcore : D.rules.hitsSafe} average boss hits to die); go carefully and fix defences first (diagnose).`,
  ];
  if (r.overridden?.length) lines.push(`- Your own enemy settings were set aside for these checks (they would make every map boss hit like them): ${r.overridden.join(", ")}.`);
  const p = survival(r.pinnacle.hits, hardcore), u = survival(r.uber.hits, hardcore);
  lines.push(`- Pinnacle bosses (PoB's pinnacle preset, level 84): ${MARK[p]}, ${hitsText(r.pinnacle.hits)} hits to die, boss DPS ${n(r.pinnacle.dps)}. Uber (level 85): ${MARK[u]}, ${hitsText(r.uber.hits)} hits, DPS ${n(r.uber.dps)}. Per boss: diagnose { boss }. PoB has no boss life data, so kill time is not judged.`);
  const deli = deliriumRows(r, hardcore);
  const okDeli = deli.filter((d) => d.survive === "safe" && d.clear !== "unsafe").map((d) => d.pct);
  lines.push(`- Delirium (T16, wiki estimates: up to ${D.facts.delirium.rows[4].incDamage}% increased monster damage and ${D.facts.delirium.rows[4].lessTakenRare}% less damage taken by rares at 100%): comfortable up to ${okDeli.length ? Math.max(...okDeli) + "%" : "none"}; ${deli.map((d) => `${d.pct}%: ${hitsText(d.hits)} hits, rare ${secs(d.rareKill)}`).join("; ")}.`);
  const sim = simulacrum(r, hardcore);
  lines.push(`- Simulacrum (${D.facts.simulacrum.waves} waves; later waves add ${D.facts.simulacrum.damageMore}% more damage and ${D.facts.simulacrum.lifeMore[0]}% more life on rares): survive ${MARK[sim.survive]} (${hitsText(sim.hits)} hits), clear ${MARK[sim.clear]} (a rare in ${secs(sim.rareKill)}).`);
  const avoid = modsToAvoid(r.mods);
  lines.push(avoid.length
    ? `- Map mods to avoid (PoB, red-map values, one at a time): ${avoid.map((m) => `${m.name} "${m.text}" (${m.why})`).join("; ")}.`
    : `- No map mod PoB models costs more than ${D.rules.modHurtPct}% on its own.`);
  lines.push(`- PoB does not model every map mod. Not checked here: "${D.facts.thorns.quote}" (wiki, Map, 3.29.0).`);
  if (r.assumptions) lines.push(`Config assumptions: ${r.assumptions}.`);
  return { lines, tier, verdicts: v };
}
