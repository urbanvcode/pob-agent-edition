/**
 * Crafting facts the planner rests on, each with its source (Stage 6).
 *
 * Rule (ROADMAP Stage 9): crafting facts come from cited, current sources or
 * PoB's data, never from memory. Every number the planner uses that is not in
 * PoB's data is here with its quote, link, game version and the date it was
 * read. What the sources do not give is marked unknown and shown as a range.
 * Quotes from poewiki.net are short and attributed (CC BY-NC-SA 3.0).
 * Re-check this file each league (ROADMAP Stage 13 checklist).
 */
export interface Fact { id: string; quote: string; source: string; url: string; version: string; dated: string; read: string; outdated?: boolean }

const WIKI = "poewiki (community wiki)";
const GGG = "GGG patch notes 3.30.0";
const NOTES_330 = "https://www.pathofexile.com/forum/view-thread/4013680";

export const FACTS: Record<string, Fact> = {
  weights: { id: "weights", source: WIKI, url: "https://www.poewiki.net/wiki/Modifier", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Tags in conjunction with weights are used to further restrict the types of modifiers that can appear and set the relative chance to be randomly applied." },
  group: { id: "group", source: WIKI, url: "https://www.poewiki.net/wiki/Modifier", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Mod group/family prevents other modifiers from the same family to be randomly generated on the same entity" },
  modLevel: { id: "modLevel", source: WIKI, url: "https://www.poewiki.net/wiki/Modifier", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Mod level governs the minimum required level of the entity for a modifier to appear (i.e. the item level, monster level, area level)" },
  limits: { id: "limits", source: WIKI, url: "https://www.poewiki.net/wiki/Crafting", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Magic items have a default modifier limit of 2 (1 prefix/1 suffix), while rare items have a default modifier limit of 6 (3 prefix/3 suffix)." },
  rareCount: { id: "rareCount", source: WIKI, url: "https://www.poewiki.net/wiki/Rarity", version: "3.29.3", dated: "2026-11-12", read: "2026-11-14", outdated: true,
    quote: "Most rare items naturally generate with 4, 5, or 6 affixes at a ratio of 8:3:1 respectively." },
  alteration: { id: "alteration", source: WIKI, url: "https://www.poewiki.net/wiki/Orb_of_Alteration", version: "3.29.0", dated: "2026-07-26", read: "2026-11-14", outdated: true,
    quote: "An Orb of Alteration is a currency item that can be used to re-roll the random modifiers on a piece of magic equipment." },
  augmentation: { id: "augmentation", source: WIKI, url: "https://www.poewiki.net/wiki/Rarity", version: "3.29.3", dated: "2026-11-12", read: "2026-11-14", outdated: true,
    quote: "A magic tem with only one affix can have a second affix added using an Orb of Augmentation" },
  regal: { id: "regal", source: WIKI, url: "https://www.poewiki.net/wiki/Regal_Orb", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "The current modifiers are all retained and one new random affix is added." },
  essence: { id: "essence", source: WIKI, url: "https://www.poewiki.net/wiki/Essence", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "All essences can be used to upgrade normal rarity equipment to rare, ensuring the item rolls one guaranteed affix." },
  essenceDrop: { id: "essenceDrop", source: WIKI, url: "https://www.poewiki.net/wiki/Essence", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Essences are primarily obtained from \"Imprisoned Monsters\" in \"Essence Monoliths\"" },
  essenceRare: { id: "essenceRare", source: WIKI, url: "https://www.poewiki.net/wiki/Essence", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Some essences can alternatively be used to reroll the affixes on rare equipment, while also ensuring one guaranteed affix is rolled." },
  chaos: { id: "chaos", source: WIKI, url: "https://www.poewiki.net/wiki/Rarity", version: "3.29.3", dated: "2026-11-12", read: "2026-11-14", outdated: true,
    quote: "Affixes can be randomly rerolled with a Chaos Orb" },
  transmutation: { id: "transmutation", source: WIKI, url: "https://www.poewiki.net/wiki/Orb_of_Transmutation", version: "3.29.0", dated: "2026-07-26", read: "2026-11-14", outdated: true,
    quote: "An Orb of Transmutation is a currency item that can be used to upgrade a piece of normal rarity equipment to magic rarity." },
  alchemy: { id: "alchemy", source: WIKI, url: "https://www.poewiki.net/wiki/Orb_of_Alchemy", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "The resulting rare has randomly chosen affixes and has a random number of affixes (ranging from four to six (three to four if used on jewels))." },
  altVendor: { id: "altVendor", source: WIKI, url: "https://www.poewiki.net/wiki/Orb_of_Alteration", version: "3.29.0", dated: "2026-07-26", read: "2026-11-14", outdated: true,
    quote: "An Orb of Alteration can also be purchased from vendors in exchange for 4 Orbs of Augmentation" },
  exalt: { id: "exalt", source: WIKI, url: "https://www.poewiki.net/wiki/Rarity", version: "3.29.3", dated: "2026-11-12", read: "2026-11-14", outdated: true,
    quote: "A rare item with less than 6 affixes can gain additional affixes using an Exalted Orb" },
  bench: { id: "bench", source: WIKI, url: "https://www.poewiki.net/wiki/Crafting_Bench", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Players can remove a crafted mod from an item using the crafting bench for the cost of an Orb of Scouring." },
  benchReroll: { id: "benchReroll", source: WIKI, url: "https://www.poewiki.net/wiki/Crafting", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "The crafting bench has recipes that spend 3 or 8 Chaos Orbs to reroll 3 or 1 mods on a rare item, respectively" },
  fossils: { id: "fossils", source: WIKI, url: "https://www.poewiki.net/wiki/Modifier", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Fossils multiply the weights of modifiers that match the type of the fossil" },
  harvest: { id: "harvest", source: WIKI, url: "https://www.poewiki.net/wiki/Crafting", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Reforges an item, guaranteeing a modifier of a certain modifier tag" },
  harvestRes: { id: "harvestRes", source: GGG, url: NOTES_330, version: "3.30.0", dated: "2026-11-11", read: "2026-11-14",
    quote: "Horticrafting crafts that change a Modifier that grants one type of Resistance into another type of Resistance now cost 300 Lifeforce of two different types" },
  recombinator: { id: "recombinator", source: WIKI, url: "https://www.poewiki.net/wiki/Crafting", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Recombinator - found in Kingsmarch: combines two items to create a new item inheriting modifiers from each item" },
  metaPrefix: { id: "metaPrefix", source: GGG, url: NOTES_330, version: "3.30.0", dated: "2026-11-11", read: "2026-11-14",
    quote: "1 Prefix Modifier cannot be changed, for a cost of 1 Divine Orb." },
  metaRecipes: { id: "metaRecipes", source: GGG, url: NOTES_330, version: "3.30.0", dated: "2026-11-11", read: "2026-11-14",
    quote: "Crafting Recipes for all Meta-Modifiers have been moved to Nightmare Maps instead." },
  benchUnlock: { id: "benchUnlock", source: WIKI, url: "https://www.poewiki.net/wiki/Crafting", version: "3.30.0", dated: "2026-11-13", read: "2026-11-14",
    quote: "Most crafts in the crafting bench are unlocked by finding crafting recipes in the campaign or in maps." },
};

/** Things the planner needs that the sources do not give: shown as a range or "unknown". */
export const UNKNOWN = {
  alterationCount: "How often an Orb of Alteration gives 1 or 2 mods is not in our sources, so the cost is a range: alterations only (always 2 mods) to an Augmentation after every alteration (always 1).",
  rareCountUse: "The 8:3:1 ratio is for rares that \"naturally generate\"; it is used here for Chaos Orbs and Essences too (an assumption). The odds for 4 mods only (worst) and 6 mods (best) are shown as the range.",
  fossilWeights: "Each fossil's weight multipliers are not in PoB's data, so fossil odds are not computed.",
  harvestWeights: "How much Harvest's guaranteed-tag reforge changes the other mods is not in our sources: odds not computed.",
  benchCost: "Bench craft costs are not in PoB's data or our sources: the bench shows the cost before you click.",
  rollSpread: "Rolls inside a tier are taken as even (an assumption): a partly matching tier counts by the share of its range that meets the number.",
};

export function cite(id: keyof typeof FACTS | string): string {
  const f = FACTS[id];
  if (!f) return "";
  return `"${f.quote}" (${f.source}, ${f.version}, ${f.url}, read ${f.read}${f.outdated ? "; page older than 3.30: may be outdated" : ""})`;
}
