// trade_search query building (offline): weapon searches use the weapon's own (Local) stats
// and weapon categories, so bow searches find what the trade site lists.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-trade-"));
const settings = path.join(tmp, "AgentEdition.json");
fs.mkdirSync(path.join(tmp, "Builds"));
process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = path.join(tmp, "Builds");
process.env.POB_AGENT_SETTINGS = settings;
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";
fs.writeFileSync(settings, JSON.stringify({ profile: { playMode: "trade", league: "Testleague" } }));

const { findStat, buildSearchQuery, categoryFor, isWeaponSearch } = await import("../build/tools/trade.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();

// The shapes of pathofexile.com/api/trade/data/stats and /data/items (ids as the site serves them).
const STATS = { result: [
  { id: "pseudo", label: "Pseudo", entries: [
    { id: "pseudo.pseudo_total_attack_speed", text: "+#% total Attack Speed", type: "pseudo" },
    { id: "pseudo.pseudo_adds_lightning_damage", text: "Adds # to # Lightning Damage", type: "pseudo" },
    { id: "pseudo.pseudo_increased_elemental_damage_with_attack_skills", text: "#% increased Elemental Damage with Attack Skills", type: "pseudo" },
    { id: "pseudo.pseudo_total_life", text: "+# total maximum Life", type: "pseudo" },
  ] },
  { id: "explicit", label: "Explicit", entries: [
    { id: "explicit.stat_210067635", text: "#% increased Attack Speed (Local)", type: "explicit" },
    { id: "explicit.stat_681332047", text: "#% increased Attack Speed", type: "explicit" },
    { id: "explicit.stat_387439868", text: "#% increased Elemental Damage with Attack Skills", type: "explicit" },
    { id: "explicit.stat_3336890334", text: "Adds # to # Lightning Damage (Local)", type: "explicit" },
    { id: "explicit.stat_1334060246", text: "Adds # to # Lightning Damage", type: "explicit" },
    { id: "explicit.stat_3299347043", text: "+# to maximum Life", type: "explicit" },
  ] },
  { id: "crafted", label: "Crafted", entries: [
    { id: "crafted.stat_210067635", text: "#% increased Attack Speed (Local)", type: "crafted" },
    { id: "crafted.stat_681332047", text: "#% increased Attack Speed", type: "crafted" },
  ] },
] };
const ITEMS = { result: [
  { id: "weapon", entries: [{ type: "Imperial Bow" }, { type: "Imperial Bow", name: "Windripper" }, { type: "Ambusher" }] },
  { id: "armour", entries: [{ type: "Astral Plate" }, { type: "Vaal Regalia" }] },
] };

function fakeTrade() {
  return {
    queries: [], itemCalls: 0,
    async getStats() { return STATS; },
    async getItems() { this.itemCalls++; return ITEMS; },
    async getLeagues() { return { result: [{ id: "Testleague" }] }; },
    async searchItems(league, q) {
      assert.equal(q.query.status.option, "securable", "instant buyout only");
      this.queries.push(q);
      return { id: "fake-search", result: [], total: 0 };
    },
    async fetchItems() { throw new Error("not used"); },
    beginCall() {},
  };
}

async function search(args) {
  const real = context.trade;
  const trade = fakeTrade();
  context.trade = trade;
  try {
    const r = await runTool(tools, context, "trade_search", args);
    assert.equal(r.isError, false, r.text);
    return { q: trade.queries[0], text: r.text, trade };
  } finally { context.trade = real; }
}

test("findStat: weapon searches use the Local stat, others keep the global/pseudo one", () => {
  assert.equal(findStat(STATS, "#% increased Attack Speed", { weapon: true }).id, "explicit.stat_210067635");
  assert.equal(findStat(STATS, "#% increased Attack Speed").id, "explicit.stat_681332047");
  assert.equal(findStat(STATS, "Adds # to # Lightning Damage", { weapon: true }).id, "explicit.stat_3336890334");
  assert.equal(findStat(STATS, "Adds # to # Lightning Damage").id, "pseudo.pseudo_adds_lightning_damage");
  assert.equal(findStat(STATS, "crafted: #% increased Attack Speed", { weapon: true }).id, "crafted.stat_210067635");
  // No local version: unchanged (elemental damage with attacks is a global mod on weapons too).
  assert.equal(findStat(STATS, "#% increased Elemental Damage with Attack Skills", { weapon: true }).id, "pseudo.pseudo_increased_elemental_damage_with_attack_skills");
  assert.equal(findStat(STATS, "pseudo: Adds # to # Lightning Damage", { weapon: true }).id, "pseudo.pseudo_adds_lightning_damage");
  assert.equal(findStat(STATS, "maximum life", { weapon: true }).id, "pseudo.pseudo_total_life");
});

test("categories and weapon detection", async () => {
  assert.equal(categoryFor("bow"), "weapon.bow");
  assert.equal(categoryFor("Bows"), "weapon.bow");
  assert.equal(categoryFor("Body Armour"), "armour.chest");
  assert.equal(categoryFor("Imperial Bow"), undefined);
  const trade = fakeTrade();
  assert.equal(await isWeaponSearch(trade, { type: "bow" }, "weapon.bow"), true);
  assert.equal(await isWeaponSearch(trade, { type: "body armour" }, "armour.chest"), false);
  assert.equal(trade.itemCalls, 0, "a category needs no item data");
  assert.equal(await isWeaponSearch(trade, { type: "Imperial Bow" }), true);
  assert.equal(await isWeaponSearch(trade, { type: "Astral Plate" }), false);
  assert.equal(await isWeaponSearch(trade, { slot: "Weapon 1" }), true);
  const offline = { async getItems() { throw new Error("offline"); } };
  assert.equal(await isWeaponSearch(offline, { type: "Spine Bow" }), true);
  assert.equal(await isWeaponSearch(offline, { type: "Astral Plate" }), undefined);
  const q = buildSearchQuery({ type: "Bows", rarity: "rare", max_price: 30 }, []);
  assert.deepEqual(q.query.filters.type_filters.filters, { category: { option: "weapon.bow" }, rarity: { option: "rare" } });
  assert.equal(q.query.type, undefined);
});

test("trade_search bow + attack speed: weapon.bow category and the Local stat id", async () => {
  const { q, text } = await search({ type: "bow", rarity: "rare", max_price: 30, stats: [{ text: "#% increased Attack Speed", min: 8 }] });
  assert.equal(q.query.type, undefined);
  assert.deepEqual(q.query.filters.type_filters.filters, { category: { option: "weapon.bow" }, rarity: { option: "rare" } });
  assert.deepEqual(q.query.filters.trade_filters.filters.price, { option: "chaos", max: 30 });
  assert.deepEqual(q.query.stats, [{ type: "and", filters: [{ id: "explicit.stat_210067635", value: { min: 8 } }] }]);
  assert.match(text, /\(Local\) rolls/);
});

test("trade_search Imperial Bow + added lightning + elemental attack damage", async () => {
  const { q, text } = await search({ type: "Imperial Bow", max_price: 30, stats: [
    { text: "Adds # to # Lightning Damage", min: 100 },
    { text: "#% increased Elemental Damage with Attack Skills", min: 20 },
    { text: "#% increased Attack Speed", min: 8 },
  ] });
  assert.equal(q.query.type, "Imperial Bow");
  assert.deepEqual(q.query.stats[0].filters.map((f) => f.id), [
    "explicit.stat_3336890334", "pseudo.pseudo_increased_elemental_damage_with_attack_skills", "explicit.stat_210067635"]);
  assert.match(text, /compare the average of the two numbers/);
});

test("trade_search armour and rings keep global and pseudo stats", async () => {
  const { q, trade } = await search({ type: "body armour", stats: [{ text: "maximum life", min: 80 }, { text: "#% increased Attack Speed" }] });
  assert.deepEqual(q.query.filters.type_filters.filters, { category: { option: "armour.chest" } });
  assert.deepEqual(q.query.stats[0].filters.map((f) => f.id), ["pseudo.pseudo_total_life", "explicit.stat_681332047"]);
  assert.equal(trade.itemCalls, 0);
  const plate = await search({ type: "Astral Plate", stats: [{ text: "#% increased Attack Speed" }] });
  assert.equal(plate.q.query.stats[0].filters[0].id, "explicit.stat_681332047");
  const named = await search({ name: "Windripper", stats: [{ text: "#% increased Attack Speed" }] });
  assert.equal(named.trade.itemCalls, 0, "no type: no item data request");
});
