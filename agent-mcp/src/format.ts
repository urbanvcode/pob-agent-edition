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
};
const ORDER = [
  "FullDPS", "CombinedDPS", "TotalDPS", "TotalDotDPS", "MinionCombinedDPS", "AverageDamage", "Speed", "CritChance", "HitChance",
  "TotalEHP", "Life", "LifeUnreserved", "EnergyShield", "Mana", "ManaUnreserved", "ManaCost",
  "FireResist", "ColdResist", "LightningResist", "ChaosResist",
  "PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken", "ChaosMaximumHitTaken",
  "Armour", "Evasion", "EffectiveSpellSuppressionChance", "BlockChance", "SpellBlockChance",
  "LifeRegenRecovery", "LifeLeechGainRate", "EffectiveMovementSpeedMod", "Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt",
];

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
    lines.push(`${label(key)}: ${n(a, 1)} -> ${n(b, 1)}${change}`);
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
