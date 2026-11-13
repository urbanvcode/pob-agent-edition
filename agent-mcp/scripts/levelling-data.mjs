#!/usr/bin/env node
/**
 * Levelling coach data (Stage 7): builds PathOfBuilding/src/Agent/LevellingData.lua
 * from current, cited sources. Re-run after each league (Stage 13 checklist):
 *
 *   npm run build && node scripts/levelling-data.mjs
 *
 * - Quest and vendor gem rewards per class, campaign area levels: poewiki.net's
 *   Cargo tables (quest_rewards, vendor_rewards, areas), read through the knowledge
 *   engine's polite fetcher (robots.txt obeyed, 2 s between requests, cached).
 * - Labs, bandits, Pantheon, resistance penalty, quest passive points, sockets and
 *   vendor recipes: short facts transcribed from the named pages. Each fact keeps a
 *   short quote, and this script stops when a quote is no longer on its page, so a
 *   changed page is noticed instead of shipping an old fact.
 * - Pages edited before the live game version's release date are flagged
 *   "may be outdated" in the data.
 *
 * poewiki.net text is CC BY-NC-SA 3.0: only short quotes, always with the link.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PoliteFetcher } from "../build/knowledge/fetcher.js";
import { Wiki } from "../build/knowledge/sources/poewiki.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../PathOfBuilding/src/Agent/LevellingData.lua");
const API = "https://www.poewiki.net/w/api.php";
const WEEK = 7 * 24 * 3600e3;
const fetcher = new PoliteFetcher({ maxRequestsPerCall: 80, minIntervalMs: 2000 });
const wiki = new Wiki(fetcher);

const CLASSES = ["Marauder", "Ranger", "Witch", "Duelist", "Templar", "Shadow", "Scion"];
const LETTER = { Marauder: "M", Ranger: "R", Witch: "W", Duelist: "D", Templar: "T", Shadow: "S", Scion: "X" };
const unescape = (s) => String(s ?? "").replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const classCode = (list) => {
  const names = String(list ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!names.length || CLASSES.every((c) => names.includes(c))) return "*";
  return CLASSES.filter((c) => names.includes(c)).map((c) => LETTER[c]).join("");
};

async function cargo(tables, fields, where = "") {
  const rows = [];
  let retrieved;
  for (let offset = 0; offset < 5000; offset += 50) {
    // No "limit=" (robots.txt disallows it): the API's 50 rows per page, paged with offset.
    const url = `${API}?action=cargoquery&tables=${tables}&fields=${encodeURIComponent(fields)}${where ? `&where=${encodeURIComponent(where)}` : ""}&order_by=${encodeURIComponent("_pageName")}&offset=${offset}&format=json`;
    const page = await fetcher.get(url, { ttlMs: WEEK });
    retrieved = page.retrieved_at;
    const body = JSON.parse(page.body);
    if (body.error) throw new Error(`${tables}: ${body.error.info}`);
    const got = (body.cargoquery ?? []).map((r) => r.title);
    rows.push(...got);
    if (got.length < 50) break;
  }
  return { rows, retrieved, url: `https://www.poewiki.net/wiki/Special:CargoTables/${tables.split(",")[0]}` };
}

async function wikitext(title) {
  const url = `${API}?action=query&prop=revisions&rvprop=content%7Ctimestamp&rvslots=main&format=json&formatversion=2&titles=${encodeURIComponent(title)}`;
  const page = await fetcher.get(url, { ttlMs: WEEK });
  const p = JSON.parse(page.body).query.pages[0];
  const rev = p.revisions?.[0];
  if (!rev) throw new Error(`No page "${title}" on poewiki.`);
  return { text: rev.slots.main.content, edited: rev.timestamp, retrieved: page.retrieved_at };
}

// --- live version (for the "may be outdated" flag) ----------------------------------------
const versions = await wiki.versions();
const live = versions.versions.find((v) => /^\d+\.\d+\.0$/.test(v.version)) ?? versions.versions[0];
console.log(`live league version ${live.version} (${live.released})`);

// --- text facts, each with a quote that must still be on its page -------------------------
const PAGES = {
  passive: "Passive skill", lab: "The Lord's Labyrinth", trials: "Trial of Ascendancy", bandits: "Deal with the Bandits",
  pantheon: "The Pantheon", resist: "Resistance", recipes: "Vendor recipe system", sockets: "Item socket",
};
const pages = {};
for (const [key, title] of Object.entries(PAGES)) pages[key] = { title, ...(await wikitext(title)) };
const flat = (s) => s.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/\{\{(?:il|c\|\w+|ql)\|(?:page=)?([^}]*)\}\}/g, "$1").replace(/'''?/g, "").replace(/\s+/g, " ");
function quote(key, text) {
  if (!flat(pages[key].text).includes(text)) throw new Error(`The quote is no longer on "${pages[key].title}": "${text}". Re-read the page and update this script.`);
  return { src: key, quote: text };
}

const facts = {
  questPointsTotal: { ...quote("passive", "There are 23-24 total, depending on your choices during the Bandit quest."), value: 23 },
  refundTotal: { ...quote("passive", "There are 20 passive respec points total from quests."), value: 20 },
  resistPenalty: [
    { after: 5, value: -30, ...quote("resist", "Completion of Part One: -30% to all resistances") },
    { after: 10, value: -60, ...quote("resist", "Completion of Part Two: -30% to all resistances (-60% total)") },
  ],
  labs: [
    { name: "Normal", monsterLevel: 33, minLevel: 0, trialActs: [1, 2, 2, 3, 3, 3], points: 2,
      ...quote("lab", "requires the completion of six different trials: one in Act 1, two in Act 2, and three in Act 3") },
    { name: "Cruel", monsterLevel: 55, minLevel: 40, trialActs: [6, 7, 7], points: 2,
      ...quote("lab", "reaching character level 40; and completing three trials, one in Act 6 and two in Act 7") },
    { name: "Merciless", monsterLevel: 68, minLevel: 50, trialActs: [8, 9, 10], points: 2,
      ...quote("lab", "reaching character level 50; and completing three trials, one each in Act 8, Act 9, and Act 10") },
    { name: "Eternal", monsterLevel: 75, minLevel: 68, trialActs: [], points: 2, maps: true,
      ...quote("lab", "reaching character level 68; and obtaining and using an Offering to the Goddess") },
  ],
  labPoints: quote("lab", "Completing a Labyrinth variant for the first time awards two Ascendancy skill points."),
  trialsShared: quote("trials", "Progression through trials is shared between all of a player's characters on a per-league basis"),
  trials: [
    { lab: "Normal", act: 1, area: "The Lower Prison" }, { lab: "Normal", act: 2, area: "The Crypt Level 1" },
    { lab: "Normal", act: 2, area: "The Chamber of Sins Level 2" }, { lab: "Normal", act: 3, area: "The Crematorium" },
    { lab: "Normal", act: 3, area: "The Catacombs" }, { lab: "Normal", act: 3, area: "The Imperial Gardens" },
    { lab: "Cruel", act: 6, area: "The Prison (Act 6)" }, { lab: "Cruel", act: 7, area: "The Crypt (Act 7)" },
    { lab: "Cruel", act: 7, area: "The Chamber of Sins Level 2 (Act 7)" }, { lab: "Merciless", act: 8, area: "The Bath House" },
    { lab: "Merciless", act: 9, area: "The Tunnel" }, { lab: "Merciless", act: 10, area: "The Ossuary" },
  ].map((t) => ({ ...t, ...quote("trials", t.area) })),
  bandits: [
    { choice: "Kraityn", config: "Kraityn", reward: "8% increased Movement Speed", ...quote("bandits", "8% increased Movement Speed") },
    { choice: "Alira", config: "Alira", reward: "+15% to all Elemental Resistances", ...quote("bandits", "+15% to all Elemental Resistances") },
    { choice: "Oak", config: "Oak", reward: "+40 to maximum Life", ...quote("bandits", "+40 to maximum Life") },
    { choice: "Kill all three", config: "None", reward: "1 Passive Skill Point", ...quote("bandits", "1 Passive Skill Point") },
  ],
  banditAct: { act: 2, ...quote("bandits", "Deal with the Bandits is a pivotal quest in Act 2") },
  banditChange: quote("bandits", "Take 20 Orb of Regret along with an amulet"),
  pantheon: { firstAct: 6, ...quote("pantheon", "become available when players defeat certain gods in Acts 6 through 10") },
  pantheonSwap: quote("pantheon", "A player can only have one major and one minor power activated at a time."),
  sockets: [
    { sockets: 4, ilvl: 25, vendorAct: 2 }, { sockets: 5, ilvl: 35, vendorAct: 4 }, { sockets: 6, ilvl: 50, vendorAct: 6 },
  ].map((s) => ({ ...s, ...quote("sockets", `| ${s.sockets} || ${s.ilvl} ||`) })),
  socketMax: quote("sockets", "Boots, helmets and gloves can have up to 4 sockets"),
  recipes: [
    { id: "ms_boots", slot: "Boots", result: "Magic Boots with % increased Movement Speed one tier higher (maximum Tier 2, 30%)",
      inputs: ["Boots (normal for the lowest tier, or magic/rare with the Movement Speed mod)", "Orb of Augmentation", "Quicksilver Flask"],
      ...quote("recipes", "Maximum tier is Tier 2 (30% increased Movement Speed)") },
    { id: "phys_weapon", slot: "Weapon", result: "Magic weapon with 40-84% increased Physical Damage (by the sash's rarity)",
      inputs: ["Weapon", "Rustic Sash (magic 40-49%, rare 50-64%, unique 65-84%)", "Blacksmith's Whetstone"],
      ...quote("recipes", "Magic Rustic Sash - the \"Heavy\" mod (40-49% - level requirement 1)") },
    { id: "spell_weapon", slot: "Weapon", result: "Magic wand/sceptre/rune dagger/staff with increased Spell Damage (one hand 10-39%, two hand 15-59%)",
      inputs: ["Rune Dagger, Sceptre, Wand or Staff", "Chain Belt (magic, rare or unique)", "Blacksmith's Whetstone"],
      ...quote("recipes", "(10 to 39%) Increased Spell Damage (one hand) or (15 to 59%) Increased Spell Damage (two hand)") },
    { id: "added_fire", slot: "Weapon", result: "Magic weapon with added Fire Damage one tier higher (maximum Tier 3)",
      inputs: ["Weapon (normal, or magic/rare with the added Fire Damage mod)", "Orb of Augmentation", "Ruby Flask"],
      ...quote("recipes", "Ruby Flask") },
    { id: "added_cold", slot: "Weapon", result: "Magic weapon with added Cold Damage one tier higher (maximum Tier 3)",
      inputs: ["Weapon (normal, or magic/rare with the added Cold Damage mod)", "Orb of Augmentation", "Sapphire Flask"],
      ...quote("recipes", "Sapphire Flask") },
    { id: "added_lightning", slot: "Weapon", result: "Magic weapon with added Lightning Damage one tier higher (maximum Tier 3)",
      inputs: ["Weapon (normal, or magic/rare with the added Lightning Damage mod)", "Orb of Augmentation", "Topaz Flask"],
      ...quote("recipes", "Topaz Flask") },
    { id: "added_phys", slot: "Weapon", result: "Magic weapon with added Physical Damage one tier higher (maximum Tier 2)",
      inputs: ["Weapon (normal, or magic/rare with the added Physical Damage mod)", "Orb of Augmentation", "Granite Flask"],
      ...quote("recipes", "Granite Flask") },
    { id: "res_rings", slot: "Ring", result: "Ruby / Topaz / Sapphire Ring (fire / lightning / cold resistance base)",
      inputs: ["Iron Ring", "a red, green or blue gem"], ...quote("recipes", "1x red gem") },
    { id: "chromatic", slot: "Sockets", result: "1 Chromatic Orb", inputs: ["an item with linked red, green and blue sockets"],
      ...quote("recipes", "Linked red, green, and blue") },
  ],
};

// --- Cargo tables ---------------------------------------------------------------------
const quests = await cargo("quest_rewards", "_pageName=item,act,quest,classes,rarity,sockets,item_level,notes");
const vendors = await cargo("vendor_rewards", "_pageName=item,act,quest,npc,classes");
const areaWhere = '(id LIKE "1\\_%" OR id LIKE "2\\_%") AND id NOT LIKE "%town%" AND act>=1 AND act<=10';
const areas = await cargo("areas", "id,name,act,area_level", areaWhere);
console.log(`quest_rewards ${quests.rows.length}, vendor_rewards ${vendors.rows.length}, areas ${areas.rows.length}`);

// Act level ranges: main campaign areas only (ids like 1_2_5_1; side areas have level 1 placeholders).
const acts = {};
for (const r of areas.rows) {
  const m = /^[12]_(\d+)_\d/.exec(r.id ?? ""), act = Number(r.act), level = Number(r["area level"]);
  if (!m || Number(m[1]) !== act || !(level > 0) || /labyrinth/i.test(r.name)) continue;
  if (act > 1 && level <= 1) continue;
  const a = (acts[act] ??= { lo: 99, hi: 0 });
  a.lo = Math.min(a.lo, level); a.hi = Math.max(a.hi, level);
}
const trialLevels = {};
for (const t of facts.trials) {
  const plain = t.area.replace(/\s*\(Act \d+\)/, "").replace("The Prison", "The Lower Prison");
  const hit = areas.rows.find((r) => Number(r.act) === t.act && unescape(r.name) === plain);
  if (hit) t.areaLevel = Number(hit["area level"]);
}
void trialLevels;

// Rewards per item: quest rewards and vendor unlocks, classes coded.
const rewards = {}, items = [], questPoints = [], refunds = [];
for (const r of quests.rows) {
  const item = unescape(r.item), quest = unescape(r.quest), act = Number(r.act);
  let m;
  if ((m = /^Book of Skill \((.*)\)$/.exec(item))) { questPoints.push({ act, quest: m[1] }); continue; }
  if ((m = /^Book of Regrets \((.*)\)$/.exec(item))) { refunds.push({ act, quest: m[1] }); continue; }
  if (r.rarity || r.sockets || r["item level"] || r.notes) {
    items.push({ item, act, quest, classes: classCode(r.classes), rarity: r.rarity ?? undefined, sockets: r.sockets ? Number(r.sockets) : undefined, ilvl: r["item level"] ? Number(r["item level"]) : undefined });
    continue;
  }
  (rewards[item] ??= { q: [], v: [] }).q.push([act, quest, classCode(r.classes)]);
}
for (const r of vendors.rows) {
  const item = unescape(r.item);
  (rewards[item] ??= { q: [], v: [] }).v.push([Number(r.act), unescape(r.npc), unescape(r.quest), classCode(r.classes)]);
}
// Keep only the rows that make an item available earlier for some class (the rest repeat
// what an earlier quest or vendor already gives): this keeps the file small.
const covers = (code) => (code === "*" ? Object.values(LETTER) : code.split(""));
for (const e of Object.values(rewards)) {
  e.q.sort((a, b) => a[0] - b[0]);
  e.v.sort((a, b) => a[0] - b[0]);
  const seenQ = new Set(), seen = new Set();
  e.q = e.q.filter((row) => { const fresh = covers(row[2]).filter((c) => !seenQ.has(c)); fresh.forEach((c) => seenQ.add(c)); return fresh.length > 0; });
  const firstQ = new Map();
  for (const row of e.q) for (const c of covers(row[2])) if (!firstQ.has(c)) firstQ.set(c, row[0]);
  e.v = e.v.filter((row) => {
    const fresh = covers(row[3]).filter((c) => !seen.has(c) && !(firstQ.get(c) <= row[0]));
    fresh.forEach((c) => seen.add(c));
    return fresh.length > 0;
  });
}
questPoints.sort((a, b) => a.act - b.act || a.quest.localeCompare(b.quest));
refunds.sort((a, b) => a.act - b.act);
if (questPoints.length !== facts.questPointsTotal.value) throw new Error(`quest_rewards lists ${questPoints.length} Book of Skill quests, the Passive skill page says ${facts.questPointsTotal.value}.`);

// Pantheon gods: where each is beaten (intro sentence of its page).
const GODS = ["Lunaris, Eternal Moon", "Solaris, Eternal Sun", "Arakaali, Spinner of Shadows", "Tsoagoth, The Brine King",
  "Abberath, the Cloven One", "Gruthkul, Mother of Despair", "Yugul, Reflection of Terror", "Shakari, Queen of the Sands",
  "Tukohama, Karui God of War", "Garukhan, Queen of the Winds", "Ralakesh, Master of a Million Faces", "Ryslatha, the Puppet Mistress"];
const intros = [...(await wiki.intros(GODS.slice(0, 8))), ...(await wiki.intros(GODS.slice(8)))];
const gods = [];
for (const p of intros) {
  const sentence = p.extract.split(/(?<=\.)\s/)[0];
  const act = Number(/Act (\d+)/.exec(p.extract)?.[1]);
  if (!act) throw new Error(`No act in the intro of ${p.title}.`);
  gods.push({ name: p.title.split(",")[0].replace(/^Tsoagoth$/, "The Brine King"), page: p.title, act, url: p.url, edited: p.edited_at, quote: sentence.slice(0, 160) });
}
gods.sort((a, b) => a.act - b.act || a.name.localeCompare(b.name));

// --- sources with freshness ---------------------------------------------------------------
const outdated = (edited) => !!(edited && live.released && edited.slice(0, 10) < live.released);
const sources = {};
for (const [key, p] of Object.entries(pages)) {
  sources[key] = { title: p.title, url: `https://www.poewiki.net/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`, edited: p.edited.slice(0, 10), retrieved: p.retrieved.slice(0, 10), outdated: outdated(p.edited) };
}
for (const [key, t] of [["quests", quests], ["vendors", vendors], ["areas", areas]]) sources[key] = { title: `poewiki Cargo table ${key === "quests" ? "quest_rewards" : key === "vendors" ? "vendor_rewards" : "areas"}`, url: t.url, retrieved: t.retrieved.slice(0, 10) };
sources.gods = { title: "poewiki god pages (intro sentences)", url: "https://www.poewiki.net/wiki/The_Pantheon", retrieved: new Date().toISOString().slice(0, 10) };

// --- Lua output -------------------------------------------------------------------------
function lua(v, indent = "") {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return JSON.stringify(v).replace(/\\u([0-9a-f]{4})/gi, (_, h) => `\\u{${h}}`);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const small = JSON.stringify(v).length < 160;
  if (Array.isArray(v)) {
    const flatArr = v.every((x) => typeof x !== "object" || x === null);
    if (flatArr || small) return `{ ${v.map((x) => lua(x)).join(", ")} }`;
    return `{\n${v.map((x) => `${indent}\t${lua(x, indent + "\t")},`).join("\n")}\n${indent}}`;
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  const RESERVED = new Set("and break do else elseif end false for function goto if in local nil not or repeat return then true until while".split(" "));
  const key = (k) => (/^[A-Za-z_]\w*$/.test(k) && !RESERVED.has(k) ? k : /^\d+$/.test(k) ? `[${k}]` : `[${lua(k)}]`);
  if (small) return `{ ${keys.map((k) => `${key(k)} = ${lua(v[k])}`).join(", ")} }`;
  return `{\n${keys.map((k) => `${indent}\t${key(k)} = ${lua(v[k], indent + "\t")},`).join("\n")}\n${indent}}`;
}
const data = {
  generated: new Date().toISOString().slice(0, 10), gameVersion: live.version, gameReleased: live.released,
  patchCheck: `GGG's ${live.version} patch notes were searched for quest, Labyrinth, campaign, Pantheon, vendor and penalty changes: none touch the facts here (checked ${new Date().toISOString().slice(0, 10)}).`,
  licence: "Facts from poewiki.net (CC BY-NC-SA 3.0), short quotes with links.",
  classes: LETTER, sources, acts, questPoints, refunds, facts, gods, items, rewards,
};
const header = `-- Levelling coach data (Stage 7). GENERATED by agent-mcp/scripts/levelling-data.mjs on ${data.generated}: do not edit by hand.
-- Sources: poewiki.net Cargo tables and pages (CC BY-NC-SA 3.0), read politely through the knowledge engine.
-- Every fact keeps its source key (see sources) and, for text facts, a short quote checked against the page.
-- Classes: M Marauder, R Ranger, W Witch, D Duelist, T Templar, S Shadow, X Scion, * every class.
-- rewards[item] = { q = { {act, quest, classes} }, v = { {act, npc, quest, classes} } } (q = quest reward, v = sold after the quest).
`;
fs.writeFileSync(OUT, header + "return " + lua(data) + "\n");
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB), ${Object.keys(rewards).length} items, ${questPoints.length} quest points, requests ${fetcher.requests}`);
