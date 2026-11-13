// Economy tests (roadmap Stage 5): budgets, price sanity, the total-budget set
// planner, own-item prices and the SSF output. Offline: poe.ninja and the trade
// site are faked (fetch is stubbed, trade is a fake client), PoB runs headless on
// a fixture build. No window, nothing written to the player's Documents.
// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-economy-"));
const builds = path.join(tmp, "Builds");
fs.mkdirSync(builds);
fs.copyFileSync(path.join(here, "fixtures", "occ-vortex.xml"), path.join(builds, "occ-vortex.xml"));
const settings = path.join(tmp, "AgentEdition.json");
process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = builds;
process.env.POB_AGENT_SETTINGS = settings;
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";

const setProfile = (profile) => fs.writeFileSync(settings, JSON.stringify({ profile }));
setProfile({ playMode: "trade", league: "Testleague", currency: { chaos: 150, divine: 3 } });

// --- fake poe.ninja -------------------------------------------------------------
const DIVINE = 200;
let ninjaCalls = 0;
let ninjaDown = false;
const NINJA_ITEMS = {
  UniqueArmour: [{ name: "Test Unique Boots", baseType: "Hydrascale Boots", chaosValue: 42, listingCount: 30 }],
  UniqueAccessory: [
    { name: "Test Unique Ring", baseType: "Paua Ring", chaosValue: 15, listingCount: 50 },
    { name: "Test Unique Ring", baseType: "Paua Ring", chaosValue: 90, variant: "rare roll", listingCount: 4 },
  ],
  SkillGem: [
    { name: "Vortex", gemLevel: 20, gemQuality: 20, chaosValue: 3 },
    { name: "Concentrated Effect Support", gemLevel: 20, gemQuality: 0, chaosValue: 8 },
    { name: "Concentrated Effect Support", gemLevel: 21, gemQuality: 0, chaosValue: 60 },
    { name: "Concentrated Effect Support", gemLevel: 21, gemQuality: 20, chaosValue: 400, corrupted: true },
    { name: "Enlighten Support", gemLevel: 3, gemQuality: 0, chaosValue: 900 },
  ],
};
globalThis.fetch = async (url) => {
  ninjaCalls++;
  const u = String(url);
  if (!u.startsWith("https://poe.ninja/")) throw new Error(`test made an unexpected request: ${u}`);
  if (ninjaDown) return new Response("down", { status: 503 });
  if (u.includes("type=Currency")) return Response.json({ lines: [{ currencyTypeName: "Divine Orb", chaosEquivalent: DIVINE }, { currencyTypeName: "Exalted Orb", chaosEquivalent: 10 }] });
  const type = new URL(u).searchParams.get("type");
  return Response.json({ lines: (NINJA_ITEMS[type] ?? []).map((l, i) => ({ id: i, icon: "x", ...l })) });
};

const budget = await import("../build/economy/budget.js");
const sanity = await import("../build/economy/sanity.js");
const setPlan = await import("../build/economy/setPlan.js");
const sell = await import("../build/economy/sell.js");
const report = await import("../build/economy/report.js");
const run = await import("../build/economy/run.js");
const ninja = await import("../build/trade/ninja.js");
const { parseBudget } = await import("../build/guideMode.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();


const RATES = new Map([["Chaos Orb", 1], ["Divine Orb", DIVINE], ["Exalted Orb", 10], ["Orb of Regret", 0.5]]);

test("budget text: several parts, aliases, k, profile, and clear errors", () => {
  assert.equal(budget.parseBudgetText("3 div + 150c", RATES).chaos, 750);
  assert.equal(budget.parseBudgetText("1.5k", RATES).chaos, 1500);
  assert.equal(budget.parseBudgetText("20 ex, 2 divines and 5", RATES).chaos, 605);
  assert.equal(budget.parseBudgetText("10 orbs of regret", RATES).chaos, 5);
  assert.match(budget.parseBudgetText("3 div + 150c", RATES).text, /3 Divine Orb \(600c\) \+ 150c = 750c/);
  assert.throws(() => budget.parseBudgetText("3 bananas", RATES), /not known/);
  assert.throws(() => budget.parseBudgetText("2 div", new Map()), /No Divine Orb rate/);
  assert.throws(() => budget.parseBudgetText("lots", RATES), /not an amount/);
  const p = budget.profileBudget({ currency: { chaos: 150, divine: 3, other: "40 ex" } }, RATES);
  assert.equal(p.chaos, 1150);
  assert.equal(p.source, "profile");
  assert.equal(budget.profileBudget({ currency: { chaos: 0, divine: 0, other: "some essences" } }, RATES), undefined);
  assert.equal(budget.resolveBudget("all", { currency: { chaos: 10, divine: 0, other: "" } }, RATES).chaos, 10);
  assert.equal(budget.resolveBudget(80, { currency: { chaos: 10, divine: 0, other: "" } }, RATES).chaos, 80);
  // The guide planner uses the same parser now.
  assert.equal(parseBudget("2 div + 10c", 100), 210);
  assert.equal(parseBudget("nonsense", 100), undefined);
});

test("price sanity: bait, wishful and stale listings are set aside", () => {
  const now = Date.parse("2026-11-14T00:00:00Z");
  const day = (d) => new Date(now - d * 86_400_000).toISOString();
  const f = sanity.fairPrice([
    { chaos: 5, indexed: day(1) }, { chaos: 48, indexed: day(1) }, { chaos: 50, indexed: day(2) }, { chaos: 52, indexed: day(3) },
    { chaos: 55, indexed: day(1) }, { chaos: 400, indexed: day(2) }, { chaos: 30, indexed: day(60) },
  ], { now });
  assert.equal(f.fair, 51, "median of 48, 50, 52, 55");
  assert.equal(f.droppedLow, 1);
  assert.equal(f.droppedHigh, 1);
  assert.equal(f.droppedOld, 1);
  assert.match(f.note, /bait or price-fixing/);
  assert.equal(f.thin, false);
  assert.equal(sanity.fairPrice([{ chaos: 10 }]).thin, true);
  assert.equal(sanity.fairPrice([]), undefined);
  assert.match(sanity.buyWarnings(10, day(1), [50, 55, 60], now).join(), /far below other listings/);
  assert.match(sanity.buyWarnings(50, day(45), [], now).join(), /listed 45 days ago/);
  assert.deepEqual(sanity.buyWarnings(50, day(2), [50, 55, 60], now), []);
});

test("knapsack: one item per slot, the best total within the budget, no listing twice", () => {
  const it = (slot, priceChaos, score, listingId) => ({ slot, priceChaos, score, listingId });
  const groups = [
    [it("Ring 1", 60, 10, "a"), it("Ring 1", 20, 6, "b")],
    [it("Ring 2", 60, 10, "a"), it("Ring 2", 30, 5, "c")],
    [it("Boots", 50, 8, "d")],
  ];
  const pick = setPlan.knapsack(groups, 100);
  assert.deepEqual(pick.map((p) => p.listingId).sort(), ["b", "c", "d"], "6 + 5 + 8 beats 10 + 8 within 100c");
  assert.ok(pick.reduce((s, p) => s + p.priceChaos, 0) <= 100);
  assert.deepEqual(setPlan.knapsack(groups, 10), []);
  const same = setPlan.knapsack([[it("Ring 1", 10, 5, "x")], [it("Ring 2", 10, 5, "x")]], 100);
  assert.equal(same.length, 1, "the same listing is never bought for two slots");
});

test("logged out: count searches instead of the weighted ones the trade site refuses", async () => {
  const up = await import("../build/trade/upgrades.js");
  const q = up.countQuery("accessory.ring", ["a", "b", "c", "d"], 50);
  assert.equal(q.query.status.option, "securable");
  assert.deepEqual(q.query.stats[0].value, { min: 2 });
  assert.deepEqual(q.sort, { price: "asc" });
  assert.equal(up.countQuery("accessory.ring", ["a"], 50).query.stats[0].value.min, 1);
  const r = up.resistQuery("accessory.ring", { Fire: 30, Cold: 5, Lightning: 0, Chaos: 0 }, 50, false);
  assert.equal(r.query.stats[0].type, "count");
  assert.deepEqual(r.query.stats[0].filters.map((f) => f.value.min), [20, 5]);
  assert.equal(up.resistQuery("accessory.ring", { Fire: 30, Cold: 5, Lightning: 0, Chaos: 0 }, 50).query.stats[0].type, "weight", "logged in: weighted as before");
});

test("poe.ninja: rates cached on disk, an old copy used (and said) when poe.ninja is down", async () => {
  const r = await ninja.ratesInfo("CacheLeague");
  assert.equal(r.rates.get("Divine Orb"), DIVINE);
  assert.equal(r.stale, false);
  const file = path.join(process.env.POB_AGENT_CACHE, "economy", "rates-CacheLeague.json");
  assert.ok(fs.existsSync(file));
  // Make the disk copy two hours old and poe.ninja unreachable: the old copy is used and flagged.
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  j.at -= 2 * 3_600_000;
  fs.writeFileSync(file, JSON.stringify(j));
  ninjaDown = true;
  try {
    const fresh = await import(`../build/trade/ninja.js?again=${Date.now()}`); // empty memory cache
    const s = await fresh.ratesInfo("CacheLeague");
    assert.equal(s.stale, true);
    assert.equal(s.rates.get("Divine Orb"), DIVINE);
    await assert.rejects(fresh.ratesInfo("NeverSeen"), /503/);
  } finally { ninjaDown = false; }
  const lines = ninja.trimLines({ lines: [{ name: "A", chaosValue: 5, icon: "x", sparkLine: {}, links: 6 }, { name: "B", chaosValue: 0 }] });
  assert.deepEqual(lines, [{ name: "A", chaosValue: 5, links: 6 }]);
});

test("own items: uniques by name and links, gems by level and quality", () => {
  const armour = [
    { name: "Kaom's Heart", baseType: "Glorious Plate", chaosValue: 100 },
    { name: "Kaom's Heart", baseType: "Glorious Plate", chaosValue: 300, links: 6 },
  ];
  assert.equal(sell.matchUnique(armour, { name: "Kaom's Heart", baseName: "Glorious Plate", links: 3 }).chaosValue, 100);
  assert.equal(sell.matchUnique(armour, { name: "Kaom's Heart", baseName: "Glorious Plate", links: 6 }).chaosValue, 300);
  assert.equal(sell.matchUnique(armour, { name: "Other", links: 0 }), undefined);
  const gems = NINJA_ITEMS.SkillGem;
  assert.equal(sell.matchGem(gems, { name: "Concentrated Effect", level: 21, quality: 0 }).chaosValue, 60, "the support suffix and the corrupted line are handled");
  assert.equal(sell.matchGem(gems, { name: "Concentrated Effect", level: 20, quality: 10 }).chaosValue, 8);
  assert.equal(sell.matchGem(gems, { name: "Vortex", level: 1, quality: 0 }), undefined);
  // A thin, wishful line is capped by a strictly better version of the gem.
  const noisy = [{ name: "Test Support", gemLevel: 20, chaosValue: 2700, listingCount: 20 }, { name: "Test Support", gemLevel: 20, gemQuality: 20, chaosValue: 380, listingCount: 70 }];
  assert.equal(sell.matchGem(noisy, { name: "Test", level: 20, quality: 0 }).chaosValue, 380);
});

// --- headless: the fixture build ------------------------------------------------
async function ok(name, args = {}) {
  const r = await runTool(tools, context, name, args);
  assert.equal(r.isError, false, `${name} failed: ${r.text}`);
  return r.text;
}
let link;
describe("headless (fixture build)", () => {
before(async () => {
  await ok("open_build", { name: "occ-vortex" });
  link = await context.pob.link();
});
after(() => context.pob.close());

test("economy_items lists the build's items with their slots and its gems", async () => {
  const own = (await link.call("economy_items")).result;
  const ring = own.items.find((i) => i.slot === "Ring 1");
  assert.equal(ring.name, "Hate Band");
  assert.equal(ring.rarity, "RARE");
  assert.ok(own.items.find((i) => i.slot === "Boots" && i.links === 4));
  assert.ok(own.gems.find((g) => g.name === "Vortex" && g.level === 21));
  const priced = await sell.priceOwn("Testleague", own);
  assert.ok(priced.priced.find((p) => p.kind === "gem" && /Concentrated Effect 21\/0/.test(p.name) && p.chaos === 60));
  assert.equal(priced.priced.find((p) => p.kind === "gem" && /Enlighten 3\/20/.test(p.name))?.chaos, 900, "a 3/20 gem is priced as at least 3/0");
  const text = report.formatSell(priced.priced, priced.notes, DIVINE);
  assert.match(text, /IN USE/);
  assert.match(text, /rare: no automatic price/);
});

test("economy_targets: readable stats and 'good enough' thresholds per slot (no trade request)", async () => {
  const t = (await link.call("economy_targets", { slots: ["Ring 1", "Belt"], focus: "balanced" })).result;
  assert.equal(t.length, 2);
  for (const s of t) {
    assert.ok(s.stats.length > 0, `${s.slot} has target stats`);
    assert.equal(s.stats[0].value, 100);
    assert.ok(s.stats.every((x) => typeof x.text === "string" && !/^explicit\./.test(x.text)), "stat ids are turned into text");
    assert.equal(new Set(s.stats.map((x) => x.text.replace(/ \(implicit\)$/, ""))).size, s.stats.length, "one line per stat");
  }
  const lines = report.targetsText(t);
  assert.match(lines.join("\n"), /Ring 1 \(now: Hate Band\): keep a rare with/);
});

// A fake trade site: a few rare listings per category, counted requests.
const listing = (id, name, typeLine, price, mods, extra = {}) => ({
  id, listing: { indexed: new Date(Date.now() - 86_400_000).toISOString(), price: { type: "~b/o", amount: price, currency: "chaos" }, account: { name: "seller-test" } },
  item: { id, name, typeLine, frameType: 2, rarity: "Rare", ilvl: 84, ...mods, ...extra },
});
const POOL = {
  "accessory.ring": [
    listing("r1", "Test Loop", "Paua Ring", 40, { implicitMods: ["+29 to maximum Mana"], explicitMods: ["+110 to maximum Life", "+45% to Fire Resistance", "+45% to Cold Resistance", "+45% to Lightning Resistance", "+16 to all Attributes", "+40 to maximum Energy Shield"] }),
    listing("r2", "Test Coil", "Paua Ring", 25, { implicitMods: ["+29 to maximum Mana"], explicitMods: ["+95 to maximum Life", "+41% to Lightning Resistance", "+14 to all Attributes", "+31 to maximum Energy Shield", "+30% to Fire Resistance", "+20% to Chaos Resistance"] }),
  ],
  "accessory.belt": [
    listing("b1", "Test Cord", "Studded Belt", 30, { implicitMods: ["23% increased Stun Duration on Enemies"], explicitMods: ["+120 to maximum Life", "+300 to Armour", "+46 to maximum Energy Shield", "+40% to Chaos Resistance", "+30% to Lightning Resistance"] }),
  ],
  "armour.boots": [
    listing("k1", "Test Road", "Hydrascale Boots", 90, { implicitMods: [], explicitMods: ["+30 to Dexterity", "60% increased Armour and Evasion", "+110 to maximum Life", "+30% to Chaos Resistance", "35% increased Movement Speed", "+40% to Fire Resistance"] }),
  ],
};
const byId = Object.fromEntries(Object.values(POOL).flat().map((l) => [l.id, l]));
function fakeTrade() {
  return {
    requests: 0,
    async searchItems(league, q) {
      this.requests++;
      assert.equal(q.query.status.option, "securable", "instant buyout only");
      assert.equal(q.query.stats[0].type, "count", "no POESESSID in the tests: the logged-out count search is used");
      const cat = q.query.filters?.type_filters?.filters?.category?.option;
      const max = q.query.filters?.trade_filters?.filters?.price?.max ?? Infinity;
      const ids = (POOL[cat] ?? []).filter((l) => l.listing.price.amount <= max).map((l) => l.id);
      return { id: `fake-${cat}`, result: ids, total: ids.length };
    },
    async fetchItems(ids) { this.requests++; return ids.map((id) => byId[id]); },
    async getLeagues() { throw new Error("not used"); },
  };
}

test("set planner: best set within the total budget, simulated together, build unchanged", async () => {
  const before = (await link.call("key_stats")).stats;
  const trade = fakeTrade();
  const plan = await setPlan.planBudget(link, trade, { league: "Testleague", budgetChaos: 100, focus: "balanced", slots: ["Ring 1", "Belt", "Boots"] });
  assert.ok(plan.buy.length >= 1, `buys something: ${JSON.stringify(plan.notes)}`);
  assert.ok(plan.spent <= 100 + 1e-9, "within budget");
  assert.equal(new Set(plan.buy.map((b) => b.slot)).size, plan.buy.length, "one item per slot");
  assert.ok(plan.combined, "the set was simulated together");
  assert.deepEqual(plan.combined.warnings, [], "resistances and attributes stay valid");
  assert.ok(plan.sims >= 1 && plan.sims <= 30);
  assert.ok(trade.requests <= 6, `2 trade requests per slot at most (made ${trade.requests})`);
  assert.ok(!plan.buy.some((b) => b.listingId === "k1" && plan.spent > 100));
  if (plan.buy.length && plan.buy.every((b) => b.priceChaos < 90)) {
    assert.ok(plan.saveFor.length === 0 || plan.saveFor[0].more > 0);
  }
  const after = (await link.call("key_stats")).stats;
  assert.equal(after.FullDPS, before.FullDPS, "build unchanged (DPS)");
  assert.equal(after.TotalEHP, before.TotalEHP, "build unchanged (EHP)");
  const text = report.formatSetPlan(plan, budget.parseBudgetText("100c", RATES), { mode: "mixed", divine: DIVINE });
  if (process.env.ECON_SHOW) console.log(text);
  assert.match(text, /BUY NOW/);
  assert.match(text, /TOGETHER \(simulated as one set in PoB\)/);
  assert.match(text, /OR CRAFT \/ FARM INSTEAD/);
  assert.match(text, /pathofexile\.com\/trade\/search\/Testleague\/fake-/);
});

test("set planner: a tight budget leaves the better item as 'save for'", async () => {
  const plan = await setPlan.planBudget(link, fakeTrade(), { league: "Testleague", budgetChaos: 30, focus: "balanced", slots: ["Ring 1"] });
  assert.ok(plan.spent <= 30);
  // The 40c ring is not searched at all (price filter = budget), so nothing to save for from this slot is fine too.
  assert.ok(plan.buy.every((b) => b.priceChaos <= 30));
});

test("budget plan text: trade uses the profile budget; SSF makes no trade request", async () => {
  setProfile({ playMode: "trade", league: "Testleague", currency: { chaos: 60, divine: 0 } });
  const trade = fakeTrade();
  const text = await run.budgetPlanText({ pob: context.pob, trade }, { league: "Testleague", budget: undefined, slots: ["Belt"] });
  assert.match(text, /total 60c \(currency on hand in the profile\)/);
  assert.match(text, /Config assumptions:/);
  setProfile({ playMode: "ssf", league: "Testleague", currency: { chaos: 60, divine: 0 } });
  const ssf = fakeTrade();
  const s = await run.budgetPlanText({ pob: context.pob, trade: ssf }, { league: "Testleague", budget: "3 div", slots: ["Ring 1", "Belt"] });
  if (process.env.ECON_SHOW) console.log(text, "\n-----\n", s);
  assert.equal(ssf.requests, 0, "SSF: no trade request");
  assert.match(s, /SSF plan/);
  assert.match(s, /keep a rare with/);
  assert.match(s, /Stage 6/);
  assert.match(s, /Stage 8/);
  setProfile({ playMode: "trade", league: "Testleague", currency: { chaos: 0, divine: 0 } });
  await assert.rejects(run.budgetPlanText({ pob: context.pob, trade: fakeTrade() }, { league: "Testleague", budget: undefined, slots: ["Belt"] }), /No budget/);
  const sold = await run.sellText({ pob: context.pob, trade: fakeTrade() }, "Testleague");
  assert.match(sold, /What your items are worth/);
  assert.match(sold, /no trade request was made/);
});

test("public tools: plan_upgrades { budget } in SSF and prices { own: true } (no trade request)", async () => {
  setProfile({ playMode: "ssf", league: "Testleague", currency: { chaos: 60, divine: 0 } });
  const plan = await ok("plan_upgrades", { budget: "all", slots: ["Belt"] });
  assert.match(plan, /SSF plan/);
  assert.match(plan, /Belt \(now: Kraken Snare\)/);
  setProfile({ playMode: "trade", league: "Testleague", currency: { chaos: 60, divine: 0 } });
  const own = await ok("prices", { own: true });
  assert.match(own, /What your items are worth/);
  assert.match(own, /Concentrated Effect 21\/0 \[Body Armour\]: ~60c/);
  const bad = await runTool(tools, context, "plan_upgrades", { budget: "3 bananas" });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /not known/);
});
});
