#!/usr/bin/env node
/**
 * Farming & money advisor data (Stage 8): builds src/farming/data.ts from current,
 * cited sources. Re-run after each league (Stage 13 checklist, step 5):
 *
 *   npm run build && node scripts/farming-data.mjs && npm run build
 *
 * - Content facts (map tiers and area levels, voidstones, Nightmare maps, Threads,
 *   Shaped Regions, Delirium and Simulacrum scaling, rare monster life): poewiki.net
 *   pages and Cargo tables, read through the knowledge engine's polite fetcher
 *   (robots.txt obeyed, 2 s between requests, cached a week).
 * - League changes (Threads replaced Scarabs, atlas points, Thread types): GGG's
 *   official patch notes for the live league.
 * - Every fact keeps a short quote; this script stops when a quote is no longer on
 *   its page or in the patch notes, so a changed page is noticed instead of shipping
 *   an old fact. Pages edited before the live version's release are flagged.
 * - Nothing here is extracted from game files. Advisor rules (how many hits is
 *   "safe") are our own judgement and are labelled as such in the data.
 *
 * poewiki.net text is CC BY-NC-SA 3.0: only short quotes, always with the link.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Knowledge } from "../build/knowledge/engine.js";
import { PoliteFetcher } from "../build/knowledge/fetcher.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../src/farming/data.ts");
const API = "https://www.poewiki.net/w/api.php";
const WEEK = 7 * 24 * 3600e3;
const fetcher = new PoliteFetcher({ maxRequestsPerCall: 80, minIntervalMs: 2000 });
const kb = new Knowledge({ fetcher });

// --- live version ----------------------------------------------------------------------------
const version = await kb.versions.info();
const live = version.current;
console.log(`live version ${live.version} (${live.released ?? "date unknown"})`);
const league = live.version.split(".").slice(0, 2).join(".");

// --- wiki pages --------------------------------------------------------------------------------
const PAGES = {
  atlas: "Atlas of Worlds", map: "Map", tiers: "Template:Map tier table", voidstone: "Voidstone", nightmare: "Nightmare Map",
  pinnacle: "Pinnacle boss", thread: "Thread", shaped: "Shaped Region", delirium: "Delirium", simulacrum: "Simulacrum",
  rarity: "Rarity", breach: "Breach", legion: "Legion", expedition: "Expedition", ritual: "Ritual",
  blight: "Blight (game mechanic)", abyss: "Abyss", bestiary: "Bestiary", betrayal: "Immortal Syndicate",
  incursion: "Incursion", ultimatum: "Ultimatum", essence: "Essence",
  harvest: "Harvest", heist: "Heist", harbinger: "Harbinger", divination: "Divination card",
};
const pages = {};
for (const [key, title] of Object.entries(PAGES)) {
  const url = `${API}?action=query&prop=revisions&rvprop=content%7Ctimestamp&rvslots=main&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(title)}`;
  const page = await fetcher.get(url, { ttlMs: WEEK });
  const p = JSON.parse(page.body).query.pages[0];
  const rev = p.revisions?.[0];
  if (!rev) throw new Error(`No page "${title}" on poewiki.`);
  pages[key] = { title: p.title, text: rev.slots.main.content, edited: rev.timestamp.slice(0, 10), retrieved: page.retrieved_at.slice(0, 10) };
}
const flat = (s) => s
  .replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
  .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
  .replace(/\{\{(?:il|c\|\w+|ql|psl)\|(?:page=)?([^}|]*)(?:\|([^}|=]*))?[^}]*\}\}/g, (_, a, b) => b || a)
  .replace(/'''?/g, "").replace(/\s+/g, " ");
const flats = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, flat(p.text)]));
const missing = [];
function q(key, text) {
  if (!flats[key].includes(text)) missing.push(`[${key}] The quote is no longer on "${pages[key].title}": "${text}". Re-read the page and update this script.`);
  return { src: key, quote: text };
}

// --- patch notes -------------------------------------------------------------------------------
const patch = await kb.patch({ version: league, max: 5000 });
// The league's main notes ("Content Update 3.30.0 — Path of Exile: <league>"), not a later hotfix thread.
const thread = patch.threads.find((t) => /Content Update/i.test(t.title)) ?? patch.threads.find((t) => !/[a-z]$/.test(t.version) && !/hotfix/i.test(t.title)) ?? patch.threads[0];
if (!thread) throw new Error(`No patch notes found for ${league}.`);
const patchLines = patch.threads.flatMap((t) => t.lines.flatMap((l) => [l.text, `${l.parent ?? ""} > ${l.text}`]));
function p(text) {
  if (!patchLines.some((l) => l.includes(text))) missing.push(`Not in the ${league} patch notes any more: "${text}".`);
  return { src: "patch", quote: text };
}

// --- Cargo: rare and magic monster life by level -------------------------------------------------
const lifeUrl = `${API}?action=cargoquery&tables=monster_life_scaling&fields=${encodeURIComponent("level,magic,rare")}&where=${encodeURIComponent("level>=68 AND level<=86")}&offset=0&format=json`;
const lifePage = await fetcher.get(lifeUrl, { ttlMs: WEEK });
const lifeRows = JSON.parse(lifePage.body).cargoquery.map((r) => r.title);
const rareLife = Object.fromEntries(lifeRows.map((r) => [Number(r.level), Number(r.rare)]));
const magicLife = Object.fromEntries(lifeRows.map((r) => [Number(r.level), Number(r.magic)]));
if (!rareLife[83]) throw new Error("monster_life_scaling has no row for level 83");

// --- facts -------------------------------------------------------------------------------------
const facts = {
  mapTiers: [
    { tiers: [1, 5], color: "white", areaLevel: [68, 72], bonus: "magic or higher", ...q("tiers", "|1-5 |68-72") },
    { tiers: [6, 10], color: "yellow", areaLevel: [73, 77], bonus: "rare", ...q("tiers", "|6-10 |73-77") },
    { tiers: [11, 16], color: "red", areaLevel: [78, 83], bonus: "corrupted rare", ...q("tiers", "|11-16 |78-83") },
  ],
  bonusObjectives: q("atlas", "white tier maps require a magic or higher rarity map"),
  bonusPoints: q("atlas", "Completing this bonus objective awards a skill point for the Atlas Passive Skill Tree"),
  uniqueMapPoints: q("atlas", "as well as up to 10 from competing any 10 different unique maps"),
  atlasPointsTotal: { value: 150, ...p("The total number of Atlas Passive Skill Points you can earn has been increased to 150") },
  startLevel: q("map", "the first maps with an area level of 68 are located"),
  mapDrops: q("map", "map bosses can drop +2 tiers above the map area the character is in"),
  thorns: q("map", "Reflect Map Modifiers have been reworked, instead of causing Monsters to Reflect a percentage of Physical or Elemental Hit Damage dealt to them, they instead cause Rare Monsters to have Physical or Elemental Thorns."),
  vendorUpgrade: q("map", "If a player has three maps of the same tier, they can be sold to a vendor to receive a new map one tier higher."),
  voidstones: [
    { name: "Eldritch Voidstone", bosses: ["The Searing Exarch", "The Eater of Worlds"], ...q("voidstone", "Eldritch Voidstone: The Searing Exarch and the Eater of Worlds") },
    { name: "Decayed Voidstone", bosses: ["The Shaper", "The Elder"], alt: "Uber Elder", ...q("voidstone", "Decayed Voidstone: The Shaper and The Elder (or Uber Elder)") },
    { name: "Originator Voidstone", bosses: ["Incarnation of Dread"], ...q("voidstone", "Originator Voidstone: Incarnation of Dread") },
    { name: "Ceremonial Voidstone", bosses: ["The Maven"], ...q("voidstone", "Ceremonial Voidstone: The Maven") },
  ],
  voidstoneEffect: q("voidstone", "Maps on the quadrant the Voidstone is socketed to have their minimum map tier raised to 16"),
  voidstoneGold: q("voidstone", "convert maps tier 15 or lower that drop into Gold"),
  nightmareChance: q("voidstone", "resulting in a 6.4% chance with four voidstones"),
  nightmare: { areaLevel: 83, ...q("nightmare", "Nightmare maps have an area area level of 83 like other T16 maps") },
  nightmareBridge: q("nightmare", "These maps are meant to act as a bridge to uber pinnacle boss content"),
  uberAccess: q("pinnacle", "Many pinnacle bosses have an \"Uber\" or \"unleashed\" variant that can be accessed with Uber fragments obtained from Nightmare map bosses"),
  uberFirst: q("pinnacle", "Their base versions must be defeated at least once in order to challenge their Uber versions."),
  scarabsGone: p("Scarabs have been removed from the game. A new item type, Threads, have been added in their place."),
  threads: q("thread", "Up to a maximum of eight threads, of up to three different types of primary league mechanics, can be used via the Atlas of Worlds interface when opening a map"),
  threadsFirst: q("thread", "Initially, only one thread type can be used"),
  threadScaling: q("thread", "it is not always optimal to use the maximum number of threads"),
  threadToughness: q("thread", "Each thread used also increases the item rarity and Toughness of enemies from that league mechanic."),
  frayed: p("Added a new Currency Item, Frayed Thread which can be used to grant a random Thread, or vendored for a random Thread."),
  shaped: p("Shaped Regions grant affected Maps free Threads of that type."),
  shapedFree: q("shaped", "Free threads are mandatory and must be used."),
  atlasDrops: p("Each percentage of increased Atlas Drops increases the quantity of Maps and Threads found in the area by 1%."),
  rareLife: { byLevel: rareLife, magicByLevel: magicLife, ...q("rarity", "Additionally rare monsters receive a life multiplier based on their level") },
  delirium: {
    rows: [
      { pct: 20, incDamage: 6, lessTakenUnique: 16, lessTakenRare: 18 },
      { pct: 40, incDamage: 12, lessTakenUnique: 32, lessTakenRare: 36 },
      { pct: 60, incDamage: 18, lessTakenUnique: 48, lessTakenRare: 54 },
      { pct: 80, incDamage: 24, lessTakenUnique: 64, lessTakenRare: 73 },
      { pct: 100, incDamage: 30, lessTakenUnique: 80, lessTakenRare: 90 },
    ],
    ...q("delirium", "Higher percentages of Delirium increase both monster damage and monster damage reduction."),
    estimate: q("delirium", "it was possible to obtain the following scaling estimates"),
  },
  simulacrum: {
    waves: 15, lifeMore: [360, 500], damageMore: 70, deliriousFrom: 10,
    ...q("simulacrum", "There are a total of 15 waves of enemies to defeat."),
    scaling: q("simulacrum", "Monsters also gain up to 360-500% more life (unique/rare vs magic/normal respectively) and 70% more damage in later waves"),
    splinters: q("simulacrum", "|recipe1_part1_amount = 300"), splinterSource: q("delirium", "Simulacrum Splinter, cluster jewels and Delirium orbs are obtained from Delirium encounters"),
  },
};
// The Delirium table is checked row by row (numbers in wikitext rows).
for (const r of facts.delirium.rows) {
  const row = `| ${r.pct}% || ${r.incDamage}% || ${r.lessTakenUnique}%`;
  if (!pages.delirium.text.includes(row)) throw new Error(`Delirium table row changed: "${row}"`);
}
for (const n of [1, 9, 13]) if (!pages.simulacrum.text.includes(`| ${n === 13 ? "13-15" : n} ||`)) throw new Error(`Simulacrum wave table changed (wave ${n}).`);

// --- strategies --------------------------------------------------------------------------------
// keys: words that mark the mechanic's atlas notables in GGG's tree data (to skip stray nodes).
// atlas: the atlas mastery name in PoB's atlas data (none = no atlas preset, e.g. Heist).
// demands: what the content asks of the build (advisor rule, from the quoted description):
//   clear = many monsters quickly (DPS vs rare life), tank = hard hits / long fights (max hit, hits to die),
//   boss = a single strong enemy (single-target DPS). `ninja` = poe.ninja categories and name filters
//   for what the content yields (only outputs a quoted source names).
const strategies = [
  { id: "breach", keys: "Breach|Hive|Wombgift|Hiveblood", name: "Breach", thread: "Breach Thread", atlas: "Breach", demands: ["clear"],
    what: q("breach", "Breaches are split into two types: Unstable Breaches and Breach Hives."),
    rewards: q("breach", "All Breach encounters grant an amount of Hiveblood and a chance for one or more wombgifts to drop on successful completion."),
    mods: [q("thread", "Area contains additonal Unstable Breaches")],
    ninja: [{ type: "Currency", match: "Wombgift|Hiveblood" }, { type: "Fragment", match: "Wombgift|Hiveblood" }] },
  { id: "legion", keys: "Legion|Timeless", name: "Legion", thread: "Legion Thread", atlas: "Legion", demands: ["clear"],
    what: q("legion", "Legions are ancient armies frozen in the midst of battle."),
    rewards: q("legion", "100 Splinters of the same type can be combined into an Emblem."),
    ninja: [{ type: "Fragment", match: "Timeless .* (Splinter|Emblem)" }] },
  { id: "expedition", keys: "Expedition|Explosive|Runic|Logbook", name: "Expedition", thread: "Expedition Thread", atlas: "Expedition", demands: ["clear", "tank"],
    what: q("expedition", "The player can place up to five explosives in the area marked by dirt heaps"),
    rewards: q("expedition", "Each explosion will unearth monsters and treasures inside the blast area, which drop items and artifacts."),
    mods: [q("thread", "Increases the size of the Expedition site")],
    ninja: [{ type: "Artifact", match: "." }] },
  { id: "ritual", keys: "Ritual|Tribute", name: "Ritual", thread: "Ritual Thread", atlas: "Ritual", demands: ["tank", "clear"],
    what: q("ritual", "players must defeat the enemies enclosed within the Ritual Circle, gaining Tribute in the process"),
    rewards: q("ritual", "Omens are now offered as Ritual Rewards."),
    mods: [q("thread", "Area contains the Bodach's Ritual")],
    ninja: [{ type: "Omen", match: "." }] },
  { id: "blight", keys: "Blight|Oil", name: "Blight", thread: "Blight Thread", atlas: "Blight", demands: ["clear"],
    what: q("blight", "Blight encounters will have at least one lane that contains a Blight reward"),
    rewards: q("blight", "Oil rewards chests have a baseline ~15% chance to drop a Blighted Map."),
    mods: [q("thread", "Blight lanes are Mycotic")],
    ninja: [{ type: "Oil", match: "." }] },
  { id: "abyss", keys: "Abyss", name: "Abyss", thread: "Abyss Thread", atlas: "Abyss", demands: ["clear"],
    what: q("abyss", "Abysses are interactable objects in instances which spawns cracks and pits that spawn monsters."),
    rewards: q("abyss", "Abyss is now the exclusive source of Abyssal Jewels and Stygian Vises"), ninja: [] },
  { id: "bestiary", keys: "Beast|Bestiary", name: "Bestiary", thread: "Bestiary Thread", atlas: "Bestiary", demands: ["tank"],
    what: q("bestiary", "The Bestiary is an interface to classify captured beasts"), ninja: [] },
  { id: "betrayal", keys: "Syndicate|Betrayal|Safehouse", name: "Betrayal (Immortal Syndicate)", thread: "Betrayal Thread", atlas: "Betrayal", demands: ["tank"],
    what: q("betrayal", "Syndicate members can drop veiled items"),
    rewards: q("betrayal", "Safehouse leaders have a chance to drop Veiled Chaos Orbs (~50% at Rank 3), certain types of Allflame embers"),
    mods: [q("thread", "Dropped veiled items have a chance to unveil fractured veiled mods")],
    ninja: [{ type: "Currency", match: "^Veiled " }, { type: "AllflameEmber", match: "." }, { type: "Fragment", match: "^Syndicate Medallion$" }] },
  { id: "incursion", keys: "Incursion|Temple|Alva", name: "Incursion", thread: "Incursion Thread", atlas: "Incursion", demands: ["clear"],
    what: q("incursion", "A temporal incursion is a short-duration visit to the past"), ninja: [] },
  { id: "ultimatum", keys: "Ultimatum|Trial", name: "Ultimatum (Trials of Chaos)", thread: "Ultimatum Thread", atlas: "Ultimatum", demands: ["tank"],
    what: q("ultimatum", "The altar displays a reward, the objective, and three modifiers to choose from."),
    rewards: q("ultimatum", "Rewards include corrupted (including double corrupted) rare items and maps, corrupted unique items, divination cards, currency, catalysts, and Inscribed Ultimatums."),
    mods: [q("thread", "Adds the option to Double Down")], ninja: [{ type: "Currency", match: "Catalyst$" }] },
  { id: "essence", keys: "Essence|Imprisoned", name: "Essence", atlas: "Essence", demands: ["clear"],
    what: q("essence", "Essences are primarily obtained from \"Imprisoned Monsters\" in \"Essence Monoliths\""),
    rewards: q("essence", "The average number of Essences held by a monster scales with Atlas Drop stats."),
    ninja: [{ type: "Essence", match: "." }] },
  { id: "delirium", keys: "Delirium|Delirious|Simulacrum", name: "Delirium and Simulacrum", atlas: "Delirium", demands: ["clear", "tank"],
    what: q("delirium", "All enemies in the fog are Delirious, giving them increased damage and damage reduction."),
    rewards: q("delirium", "Enemies killed in the fog in maps can drop Cluster Jewels and Simulacrum Splinters."),
    ninja: [{ type: "DeliriumOrb", match: "." }, { type: "Fragment", match: "^Simulacrum" }] },
  { id: "harvest", keys: "Harvest|Lifeforce|Sacred|Flora", name: "Harvest", atlas: "Sacred Flora", demands: ["clear"],
    what: q("harvest", "Harvest is a league mechanic where the player fights monsters spawned by Sacred Flora to obtain lifeforce, which is used for Harvest crafting."),
    rewards: q("harvest", "Slaying Sacred Fauna drops Lifeforce."),
    ninja: [{ type: "Currency", match: "Crystallised Lifeforce$" }] },
  { id: "heist", keys: "Heist", name: "Heist (contracts)", demands: ["clear"],
    what: q("heist", "Heists are missions that can be accessed using a Contract at The Rogue Harbour."),
    rewards: q("heist", "Heist Contracts are an excellent means to generate Rogue's Markers."),
    noAtlas: q("heist", "Atlas passives do not affect areas opened by contracts or blueprints."),
    caveat: q("heist", "Rogue Markers, Contracts and Blueprints are no longer part of the core drop pool."),
    ninja: [{ type: "Currency", match: "^Rogue's Marker$" }] },
  { id: "divination", keys: "Divination|Stacked Deck", name: "Divination cards", atlas: "Divination Cards", demands: ["clear"],
    what: q("divination", "A divination card is a type of item that can be collected to exchange for a reward."),
    rewards: q("divination", "There are many different cards, each one dropping in a different part of the game and granting a different reward."),
    caveat: q("divination", "Sources of Divination Cards drops from League content such as Legion, Blight, Delirium, Heist, Ritual, Expedition and Delve now instead drop Stacked Decks."),
    ninja: [{ type: "DivinationCard", match: "." }, { type: "Currency", match: "^Stacked Deck$" }] },
  // The 3.30 league mechanic: only GGG's patch notes describe it so far (the wiki page is a stub).
  { id: "covens", keys: "Coven|Fate|Wicker|Viscera", name: "Covens of Umbra (league mechanic)", demands: ["boss", "tank"],
    what: p("Upon disrupting the coven's magicks, you will get to select a Fate for the boss of the area you're in."),
    rewards: p("Obtain Viscera from a defeated boss empowered by Fates to claim a scrap of their power for your own."),
    caveat: p("A fully empowered boss can be quite a threatening fight"),
    ninja: [{ item: "UniqueAccessory", match: "^Doedre's Tongue$", ...p("The Doedre's Tongue Unique Amulet can no longer drop outside of Covens of Umbra encounters.") }] },
];
// Mechanics left out on purpose, with the quote that says why.
const excluded = [
  { name: "Harbinger", ...q("harbinger", "Harbingers have been removed from the game in Version 3.28.0") },
];
for (const s of strategies) if (s.thread) p(`> ${s.thread}`);

if (missing.length) { console.error(missing.join("\n")); process.exit(1); }

// --- advisor rules (our judgement, not game facts) ---------------------------------------------
const rules = {
  note: "Advisor rules of thumb (PoB Agent Edition), not game facts: how much margin counts as safe. Every number they are applied to comes from PoB.",
  hitsSafe: 4, hitsRisky: 2, hitsSafeHardcore: 6,
  rareKillComfortable: 2, rareKillSlow: 6,
  modHurtPct: 15,
  // Market flags on poe.ninja outputs: falling at least this % over poe.ninja's last days = "sell soon";
  // thin = under this many traded (volume / price) or this much chaos volume.
  fallingPct: -20, thinTrades: 5, thinVolumeChaos: 20,
};

const sources = Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, {
  title: v.title, url: `https://www.poewiki.net/wiki/${encodeURIComponent(v.title.replace(/ /g, "_"))}`, edited: v.edited, retrieved: v.retrieved,
  outdated: live.released && v.edited < live.released ? true : undefined,
  needsUpdate: v.text.match(/\{\{update\|reason=([^}]*)\}\}/i)?.[1]?.trim() || undefined,
}]));
sources.patch = { title: thread.title, url: thread.url, edited: thread.posted_at?.slice(0, 10), retrieved: thread.retrieved_at.slice(0, 10) };
sources.cargo = { title: "poewiki Cargo table monster_life_scaling", url: "https://www.poewiki.net/wiki/Special:CargoTables/monster_life_scaling", retrieved: lifePage.retrieved_at.slice(0, 10) };

const data = { version: live.version, league: thread.title.replace(/^.*Path of Exile:\s*/, ""), released: live.released, generated: new Date().toISOString().slice(0, 10), sources, facts, strategies, excluded, rules };
const header = `// Generated by scripts/farming-data.mjs on ${data.generated} from poewiki.net (CC BY-NC-SA 3.0, short quotes with links)\n// and GGG's ${league} patch notes. Do not edit by hand: re-run the script after each league (ROADMAP Stage 13 checklist).\n/* eslint-disable */\n`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${header}export const FARMING_DATA = ${JSON.stringify(data, null, 1)} as const;\n`);
console.log(`wrote ${OUT} (${strategies.length} strategies, ${Object.keys(sources).length} sources)`);
