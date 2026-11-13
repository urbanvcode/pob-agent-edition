/**
 * Craft targets (Stage 6): "a ring with life, 2 res, crit multi" -> wants,
 * each matched against the mods PoB says the base can roll.
 *
 * A want is "count of these alternatives" (2 res = 2 of fire/cold/lightning).
 * Without a number a want counts the top 3 tiers that can roll at the item
 * level; "life 70+" counts tiers that can reach 70 (by the share of the range
 * that does, rolls taken as even), "T1 life" only the best tier.
 */

export interface PoolMod {
  id: string; type: "Prefix" | "Suffix"; group: string; level: number; weight: number;
  tier: number; tiers: number; name?: string; lines: string[]; tags?: string[]; trade?: string[]; influence?: boolean;
}
export interface PoolLine { type: string; group: string; level: number; lines: string[]; name?: string; tier?: number; modId?: string; trade?: string[] }
export interface Pool {
  base: string; class: string; ilvl: number; limit: number; influence?: string;
  mods: PoolMod[]; essences: PoolLine[]; bench: PoolLine[]; eldritch: PoolLine[];
  current?: { name?: string; base?: string; rarity?: string; itemLevel?: number };
}

export interface Alt { label: string; re: RegExp }
export interface Want { text: string; count: number; alts: Alt[]; min?: number; maxTier?: number }
export interface Hit { alt: number; share: number }

/** "+(80-89) to maximum Life" and "+85 to maximum Life" both become "+# to maximum life". */
export const template = (line: string) =>
  line.replace(/\((-?[\d.]+)-(-?[\d.]+)\)/g, "#").replace(/-?\d+(\.\d+)?/g, "#").toLowerCase().trim();

/** Number ranges of a mod line, in order. */
export function rangesOf(line: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /\((-?[\d.]+)-(-?[\d.]+)\)|(-?\d+(?:\.\d+)?)/g;
  for (let m; (m = re.exec(line));) out.push(m[3] !== undefined ? [Number(m[3]), Number(m[3])] : [Number(m[1]), Number(m[2])]);
  return out;
}

/** A line with every range at the given roll (0 = lowest, 0.5 = average, 1 = highest), whole numbers. */
export const atRoll = (line: string, roll = 0.5) =>
  line.replace(/\((-?[\d.]+)-(-?[\d.]+)\)/g, (_, a, b) => String(Math.round(Number(a) + (Number(b) - Number(a)) * roll)));

const r = (s: string) => new RegExp(`^${s}$`, "i");
const RES = (e: string): Alt => ({ label: `${e[0].toUpperCase()}${e.slice(1)} Resistance`, re: r(`\\+#% to ${e} resistance`) });
const ELE = [RES("fire"), RES("cold"), RES("lightning")];

/** Short names players use, to the mod lines they mean (PoB's line templates). */
const ALIASES: Array<[RegExp, Alt[]]> = [
  [/^(ele(mental)? )?(res|resi|resist|resists|resistance|resistances)$/, ELE],
  [/^fire( res(ist(ance)?)?)?$/, [ELE[0]]], [/^cold( res(ist(ance)?)?)?$/, [ELE[1]]], [/^(light(ning)?|lite)( res(ist(ance)?)?)?$/, [ELE[2]]],
  [/^chaos res(ist(ance)?)?$/, [{ label: "Chaos Resistance", re: r("\\+#% to chaos resistance") }]],
  [/^all (ele(mental)? )?res(ist(ance)?s?)?$/, [{ label: "all Elemental Resistances", re: r("\\+#% to all elemental resistances") }]],
  [/^(flat |max(imum)? )?life$|^hp$/, [{ label: "maximum Life", re: r("\\+# to maximum life") }]],
  [/^%( max(imum)?)? life$|^(increased|%) (max(imum)? )?life$/, [{ label: "% increased maximum Life", re: r("#% increased maximum life") }]],
  [/^(flat )?(es|energy shield)$/, [{ label: "maximum Energy Shield", re: r("\\+# to maximum energy shield") }]],
  [/^%( increased)? (es|energy shield)$/, [{ label: "% increased Energy Shield", re: r("#% increased (maximum )?energy shield") }]],
  [/^(flat )?mana$/, [{ label: "maximum Mana", re: r("\\+# to maximum mana") }]],
  [/^crit(ical)?( strike)? multi(plier)?$/, [{ label: "Critical Strike Multiplier", re: /critical strike multiplier/i }]],
  [/^crit(ical)?( strike)?( chance)?$/, [{ label: "Critical Strike Chance", re: /critical strike chance/i }]],
  [/^(attack speed|as|ias)$/, [{ label: "increased Attack Speed", re: r("#% increased attack speed") }]],
  [/^(cast speed|cs)$/, [{ label: "increased Cast Speed", re: r("#% increased cast speed") }]],
  [/^(movement speed|move speed|ms|movespeed)$/, [{ label: "increased Movement Speed", re: r("#% increased movement speed") }]],
  [/^(str|strength)$/, [{ label: "Strength", re: r("\\+# to strength") }]],
  [/^(dex|dexterity)$/, [{ label: "Dexterity", re: r("\\+# to dexterity") }]],
  [/^(int|intelligence)$/, [{ label: "Intelligence", re: r("\\+# to intelligence") }]],
  [/^(all )?attributes$|^all attr$/, [{ label: "all Attributes", re: r("\\+# to all attributes") }]],
  [/^spell (damage|dmg)$/, [{ label: "increased Spell Damage", re: r("#% increased spell damage") }]],
  [/^(spell )?suppress(ion)?$/, [{ label: "Spell Suppression", re: /suppress spell damage/i }]],
  [/^accuracy$/, [{ label: "Accuracy Rating", re: r("\\+# to accuracy rating") }]],
  [/^(flat |added )?phys(ical)?( damage)?( to attacks)?$/, [{ label: "added Physical Damage", re: /^adds # to # physical damage/i }]],
];

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9%+ ]+/g, " ").split(/\s+/).filter(Boolean);

/** One want from text like "2 res", "life 70+", "T1 life", "+1 to level of socketed gems". */
export function parseWant(raw: string): Want {
  // "total" comes from the trade site's pseudo stats ("+#% total to Fire Resistance").
  let text = raw.trim().replace(/\s+/g, " ").replace(/\btotal\s+/i, "");
  let count = 1, min: number | undefined, maxTier: number | undefined;
  let m = text.match(/^t(\d)\s+(.*)$/i) || text.match(/^(.*?)\s+t(\d)\+?$/i);
  if (m) { const [a, b] = /^t/i.test(text) ? [m[1], m[2]] : [m[2], m[1]]; maxTier = Number(a); text = b; }
  if ((m = text.match(/^(\d+(?:\.\d+)?)\s*\+\s*(.*)$/))) { min = Number(m[1]); text = m[2]; }
  else if ((m = text.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*\+?$/))) { min = Number(m[2]); text = m[1]; }
  else if ((m = text.match(/^(\d)\s*x?\s+(.*)$/i))) { count = Number(m[1]); text = m[2]; }
  const key = text.toLowerCase().replace(/^(to |of |\+ ?)/, "").trim();
  for (const [re, alts] of ALIASES) if (re.test(key)) return { text: raw.trim(), count: Math.min(count, alts.length), alts, min, maxTier };
  // Anything else: every word must appear in the mod line (numbers ignored).
  const w = words(template(text)).filter((x) => !/^[#+%]+$/.test(x));
  const re = new RegExp(w.map((x) => `(?=.*${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`).join(""), "i");
  return { text: raw.trim(), count: 1, alts: [{ label: text, re }], min, maxTier };
}

/** "life, 2 res, crit multi" or "life and 2 res" -> wants. */
export function parseWants(text: string): Want[] {
  const body = text.replace(/^\s*(a|an)\s+[\w ]+?\s+with\s+/i, "");
  return body.split(/,|;|\n|\band\b|\s\+\s/i).map((s) => s.trim()).filter(Boolean).map(parseWant);
}

/** The best (lowest) tier number that can roll at this item level, per group. */
export function bestTiers(mods: PoolMod[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const m of mods) best.set(m.type + m.group, Math.min(best.get(m.type + m.group) ?? 99, m.tier));
  return best;
}

/**
 * How much a mod line set meets an alternative: 0 = no, 1 = yes, in between =
 * the share of its roll range that reaches want.min (rolls taken as even).
 */
export function share(lines: string[], alt: Alt, want: Want, tierOk: boolean): number {
  if (lines.length !== 1 || !alt.re.test(template(lines[0]))) return 0;
  if (want.min === undefined) return tierOk ? 1 : 0;
  const rg = rangesOf(lines[0]);
  if (!rg.length) return 0;
  // Several numbers ("Adds # to #"): judge by the sum of the averages.
  if (rg.length > 1) {
    const lo = rg.reduce((s, x) => s + Math.min(...x), 0), hi = rg.reduce((s, x) => s + Math.max(...x), 0);
    return hi < want.min ? 0 : lo >= want.min ? 1 : (hi - want.min) / Math.max(hi - lo, 1);
  }
  const [a, b] = rg[0];
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (hi < want.min) return 0;
  if (lo >= want.min) return 1;
  return (hi - want.min + 1) / (hi - lo + 1);
}

/** For every pool mod, which wants (and alternatives) it meets. */
export function hitsOf(pool: PoolMod[], wants: Want[]): Array<Array<{ want: number; alt: number; share: number }>> {
  const best = bestTiers(pool);
  return pool.map((m) => {
    const out: Array<{ want: number; alt: number; share: number }> = [];
    wants.forEach((w, wi) => w.alts.forEach((a, ai) => {
      const top = best.get(m.type + m.group) ?? m.tier;
      const tierOk = w.maxTier !== undefined ? m.tier <= w.maxTier : m.tier <= top + 2;
      const s = share(m.lines, a, w, tierOk);
      if (s > 0) out.push({ want: wi, alt: ai, share: s });
    }));
    return out;
  });
}

/** Alternatives that no mod of the pool can meet. */
export function unmatched(pool: PoolMod[], wants: Want[]): string[] {
  const hits = hitsOf(pool, wants);
  const out: string[] = [];
  wants.forEach((w, wi) => {
    const alts = new Set<number>();
    hits.forEach((h) => h.forEach((x) => { if (x.want === wi) alts.add(x.alt); }));
    if (alts.size < w.count) out.push(w.text);
  });
  return out;
}

/** Words for a want's tier rule, for the plan's header. */
export function wantRule(w: Want): string {
  const what = w.count > 1 ? `${w.count} of ${w.alts.map((a) => a.label).join(" / ")}` : w.alts.map((a) => a.label).join(" / ");
  if (w.min !== undefined) return `${what} at ${w.min}+`;
  if (w.maxTier !== undefined) return `${what} (tier ${w.maxTier} or better)`;
  return `${what} (top 3 tiers that can roll at this item level)`;
}
