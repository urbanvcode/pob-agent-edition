/**
 * Budgets (Stage 5): "3 div + 150c", "1.5k", "20 ex, 2 div" or the profile's
 * currency on hand, converted to chaos with poe.ninja rates for the league.
 */
import { n } from "../format.js";
import type { PlayerProfile } from "../profile.js";

export interface BudgetPart { amount: number; name: string; chaos: number }
export interface Budget { chaos: number; parts: BudgetPart[]; text: string; source: "given" | "profile" }

const ALIASES: Array<[RegExp, string]> = [
  [/^(c|chaos|chaoses|chaos orbs?)$/, "Chaos Orb"],
  [/^(d|div|divs|divine|divines|divine orbs?)$/, "Divine Orb"],
  [/^(ex|exa|exalt|exalts|exalted|exalted orbs?)$/, "Exalted Orb"],
  [/^(mirror|mirrors|mirror of kalandra)$/, "Mirror of Kalandra"],
  [/^(alch|alchs|alchemy|orbs? of alchemy)$/, "Orb of Alchemy"],
  [/^(regret|regrets|orbs? of regret)$/, "Orb of Regret"],
  [/^(annul|annuls|orbs? of annulment)$/, "Orb of Annulment"],
  [/^(fuse|fuses|fusing|fusings|orbs? of fusing)$/, "Orb of Fusing"],
  [/^(alt|alts|alteration|orbs? of alteration)$/, "Orb of Alteration"],
  [/^(chrome|chromes|chrom|chromatic|chromatics)$/, "Chromatic Orb"],
  [/^(vaal|vaals|vaal orbs?)$/, "Vaal Orb"],
  [/^(gcp|gcps|gemcutter'?s?( prisms?)?)$/, "Gemcutter's Prism"],
  [/^(scour|scours|orbs? of scouring)$/, "Orb of Scouring"],
  [/^(jew|jewellers?|jeweller'?s orbs?)$/, "Jeweller's Orb"],
];

export class BudgetError extends Error {}

function currencyName(word: string, rates: Map<string, number>): string | undefined {
  const w = word.toLowerCase().replace(/\s+/g, " ").trim();
  for (const [re, name] of ALIASES) if (re.test(w)) return name;
  // Any other currency poe.ninja lists, by its full name (singular or plural).
  for (const name of rates.keys()) {
    const l = name.toLowerCase();
    if (l === w || `${l}s` === w || l.replace(/ orb$/, "") === w) return name;
  }
  return undefined;
}

/** Parses "3 div + 150c" into chaos. Throws BudgetError with a hint when a part is not understood. */
export function parseBudgetText(text: string, rates: Map<string, number>): Budget {
  const parts: BudgetPart[] = [];
  const pieces = text.toLowerCase().split(/\s*(?:\+|,|\band\b|&)\s*/).map((p) => p.trim()).filter(Boolean);
  if (!pieces.length) throw new BudgetError("Empty budget.");
  for (const piece of pieces) {
    const m = /^([\d]+(?:[.,]\d+)?)\s*(k)?\s*(.*)$/.exec(piece);
    if (!m) throw new BudgetError(`"${piece}" is not an amount: use e.g. "3 div + 150c".`);
    let amount = parseFloat(m[1].replace(",", "."));
    if (m[2]) amount *= 1000;
    const word = m[3].trim();
    const name = word ? currencyName(word, rates) : "Chaos Orb";
    if (!name) throw new BudgetError(`Currency "${word}" not known: use c, div, ex or a full currency name.`);
    const rate = name === "Chaos Orb" ? 1 : rates.get(name);
    if (!rate) throw new BudgetError(`No ${name} rate from poe.ninja right now: give the budget in chaos.`);
    parts.push({ amount, name, chaos: amount * rate });
  }
  const chaos = parts.reduce((s, p) => s + p.chaos, 0);
  return { chaos, parts, text: describe(parts, chaos), source: "given" };
}

function describe(parts: BudgetPart[], chaos: number): string {
  const one = (p: BudgetPart) => (p.name === "Chaos Orb" ? `${n(p.amount)}c` : `${n(p.amount, 2)} ${p.name} (${n(p.chaos)}c)`);
  return parts.length === 1 && parts[0].name === "Chaos Orb" ? `${n(chaos)}c` : `${parts.map(one).join(" + ")} = ${n(chaos)}c`;
}

/** The profile's currency on hand in chaos ("other" is added when it reads as a budget). Undefined when nothing is set. */
export function profileBudget(profile: Pick<PlayerProfile, "currency">, rates: Map<string, number>): Budget | undefined {
  const parts: BudgetPart[] = [];
  const c = profile.currency;
  if (c.divine > 0) {
    const rate = rates.get("Divine Orb");
    if (rate) parts.push({ amount: c.divine, name: "Divine Orb", chaos: c.divine * rate });
  }
  if (c.chaos > 0) parts.push({ amount: c.chaos, name: "Chaos Orb", chaos: c.chaos });
  if (c.other) {
    try { parts.push(...parseBudgetText(c.other, rates).parts); } catch { /* free text such as "some essences" */ }
  }
  if (!parts.length) return undefined;
  const chaos = parts.reduce((s, p) => s + p.chaos, 0);
  return { chaos, parts, text: `${describe(parts, chaos)} (currency on hand in the profile)`, source: "profile" };
}

/** A budget from the argument ("all"/"profile" = currency on hand), else the profile; undefined when neither gives one. */
export function resolveBudget(given: unknown, profile: Pick<PlayerProfile, "currency">, rates: Map<string, number>): Budget | undefined {
  if (typeof given === "number" && given > 0) return { chaos: given, parts: [{ amount: given, name: "Chaos Orb", chaos: given }], text: `${n(given)}c`, source: "given" };
  const text = typeof given === "string" ? given.trim() : "";
  if (text && !/^(all|everything|profile|on hand|my currency)$/i.test(text)) return parseBudgetText(text, rates);
  return profileBudget(profile, rates);
}
