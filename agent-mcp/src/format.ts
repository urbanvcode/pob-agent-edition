/** Compact, numbers-first text helpers shared by the tools. */

export function n(value: unknown, digits = 0): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "?";
  if (digits === 0 && Math.abs(value) < 10 && !Number.isInteger(value)) digits = 2;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function pct(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

const LABELS: Record<string, string> = {
  FullDPS: "Full DPS", CombinedDPS: "Combined DPS", TotalDPS: "Hit DPS", TotalDotDPS: "DoT DPS", AverageDamage: "Average hit",
  Speed: "Attacks/casts per s", CritChance: "Crit chance %", HitChance: "Hit chance %", TotalEHP: "EHP",
  LifeUnreserved: "Life unreserved", EnergyShield: "Energy shield", ManaUnreserved: "Mana unreserved", ManaCost: "Mana cost",
  FireResist: "Fire res %", ColdResist: "Cold res %", LightningResist: "Lightning res %", ChaosResist: "Chaos res %",
  PhysicalMaximumHitTaken: "Max hit physical", FireMaximumHitTaken: "Max hit fire", ColdMaximumHitTaken: "Max hit cold",
  LightningMaximumHitTaken: "Max hit lightning", ChaosMaximumHitTaken: "Max hit chaos",
  EffectiveSpellSuppressionChance: "Spell suppression %", BlockChance: "Block %", SpellBlockChance: "Spell block %",
  LifeRegenRecovery: "Life regen/s", LifeLeechGainRate: "Life leech/s", EffectiveMovementSpeedMod: "Movement speed x",
  MinionCombinedDPS: "Minion DPS", ReqStr: "Str required", ReqDex: "Dex required", ReqInt: "Int required",
  StunAvoidChance: "Stun avoidance %", FreezeAvoidChance: "Freeze avoidance %", ChillAvoidChance: "Chill avoidance %",
  ShockAvoidChance: "Shock avoidance %", IgniteAvoidChance: "Ignite avoidance %", BleedAvoidChance: "Bleed avoidance %",
  PoisonAvoidChance: "Poison avoidance %", CorruptedBloodAvoidChance: "Corrupted Blood avoidance %",
};
const ORDER = [
  "FullDPS", "CombinedDPS", "TotalDPS", "TotalDotDPS", "MinionCombinedDPS", "AverageDamage", "Speed", "CritChance", "HitChance",
  "TotalEHP", "Life", "LifeUnreserved", "EnergyShield", "Mana", "ManaUnreserved", "ManaCost",
  "FireResist", "ColdResist", "LightningResist", "ChaosResist",
  "PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken", "ChaosMaximumHitTaken",
  "Armour", "Evasion", "EffectiveSpellSuppressionChance", "BlockChance", "SpellBlockChance",
  "LifeRegenRecovery", "LifeLeechGainRate", "EffectiveMovementSpeedMod", "Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt",
  "StunAvoidChance", "FreezeAvoidChance", "ChillAvoidChance", "ShockAvoidChance", "IgniteAvoidChance",
  "BleedAvoidChance", "PoisonAvoidChance", "CorruptedBloodAvoidChance",
];

const ailmentName = (a: string): string => (a === "CorruptedBlood" ? "corrupted blood" : a === "Bleed" ? "bleeding" : a.toLowerCase());

export const label = (key: string): string => LABELS[key] ?? key;

export type Stats = Record<string, number | undefined>;

function ordered(keys: Iterable<string>): string[] {
  const set = new Set(keys);
  return [...ORDER.filter((k) => set.has(k)), ...[...set].filter((k) => !ORDER.includes(k)).sort()];
}

/** "Combined DPS: 2,366,903 -> 2,512,004 (+6.1%)" for every stat that changed. */
export function deltaLines(before: Stats, after: Stats): string[] {
  const lines: string[] = [];
  for (const key of ordered([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key], b = after[key];
    if (a === undefined || b === undefined) continue;
    if (Math.abs(a - b) <= Math.max(Math.abs(a) * 1e-4, 1e-4)) continue;
    const absolute = key.endsWith("Resist") || key.endsWith("Chance") || a === 0;
    const change = absolute ? ` (${b - a >= 0 ? "+" : ""}${n(b - a, 1)})` : ` (${pct(((b - a) / Math.abs(a)) * 100)})`;
    // 100% ailment avoidance = immune: losing it is said in words (being frozen can kill).
    const ailment = /^(\w+?)AvoidChance$/.exec(key)?.[1];
    const immunity = ailment && a >= 100 && b < 100 ? ` - LOSES ${ailmentName(ailment).toUpperCase()} IMMUNITY`
      : ailment && b >= 100 && a < 100 ? ` - now immune to ${ailmentName(ailment)}` : "";
    lines.push(`${label(key)}: ${n(a, 1)} -> ${n(b, 1)}${change}${immunity}`);
  }
  return lines;
}

export function statLines(stats: Stats, skipZero = true): string[] {
  const lines: string[] = [];
  for (const key of ordered(Object.keys(stats))) {
    const v = stats[key];
    if (v === undefined || (skipZero && v === 0)) continue;
    lines.push(`${label(key)}: ${n(v, 1)}`);
  }
  return lines;
}

/** A mark for set_view { point } (Agent/Marks.lua). */
export interface PointMark { target: string; kind?: string; text?: string; tone?: string; to?: string; ops?: unknown[] }

/** The marks that show what a list of edit ops changes: the node, slot, flask, gem group or config option. */
export function marksFromOps(ops: unknown, text?: string): PointMark[] {
  const out: PointMark[] = [];
  for (const o of (Array.isArray(ops) ? ops : []) as any[]) {
    let m: PointMark | undefined;
    if ((o?.op === "alloc" || o?.op === "dealloc") && (o.nodes?.[0] ?? o.node) !== undefined) m = { target: String(o.nodes?.[0] ?? o.node), kind: "node" };
    else if (o?.op === "mastery" && o.node !== undefined) m = { target: String(o.node), kind: "node" };
    else if ((o?.op === "equip" || o?.op === "unequip") && o.slot) m = { target: String(o.slot), kind: "slot" };
    else if (o?.op === "flask" && o.index) m = { target: `Flask ${o.index}`, kind: "flask" };
    else if (["gem", "add_gem", "remove_gem", "group_enabled", "main_skill"].includes(o?.op) && o.group) m = { target: `group ${o.group}`, kind: "gem" };
    else if (o?.op === "config" && o.values && Object.keys(o.values).length) m = { target: Object.keys(o.values)[0], kind: "config" };
    if (m && !out.some((x) => x.target === m!.target && x.kind === m!.kind)) out.push(m);
  }
  if (out[0]) { out[0].tone = "do"; if (text) out[0].text = text; out[0].ops = ops as unknown[]; }
  return out;
}

/** One line offering the marks (several = a guided tour) for when the PoB window is open. */
export function showLine(marks: PointMark[], view = "TREE"): string {
  const list = marks.filter(Boolean).slice(0, 6);
  if (!list.length) return "";
  const point = list.length > 1 ? { tour: true, marks: list } : list;
  return `Show it in PoB (window open): set_view ${JSON.stringify({ view, point })}`;
}
