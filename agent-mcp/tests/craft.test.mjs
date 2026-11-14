// Crafting helper tests (roadmap Stage 6): targets, odds from PoB's spawn
// weights, cited facts, the PoB mod pool, craft plans (SSF and trade), guide
// items, bench quick fixes and the read-only guard. Offline: poe.ninja and the
// trade site are faked, PoB runs headless on a fixture build. No window, nothing
// written to the player's Documents.
// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-craft-"));
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
setProfile({ playMode: "ssf", league: "", currency: { chaos: 0, divine: 0 } });

// --- fake poe.ninja -------------------------------------------------------------
const RATES = { "Orb of Alteration": 0.2, "Orb of Augmentation": 0.05, "Regal Orb": 0.5, "Orb of Scouring": 0.3, "Orb of Transmutation": 0.02, "Divine Orb": 200 };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!u.startsWith("https://poe.ninja/")) throw new Error(`test made an unexpected request: ${u}`);
  if (u.includes("type=Currency")) return Response.json({ lines: Object.entries(RATES).map(([currencyTypeName, chaosEquivalent]) => ({ currencyTypeName, chaosEquivalent })) });
  const type = new URL(u).searchParams.get("type");
  if (type === "Essence") return Response.json({ lines: [{ id: 1, name: "Deafening Essence of Anger", chaosValue: 4 }, { id: 2, name: "Deafening Essence of Hatred", chaosValue: 3 }] });
  return Response.json({ lines: [] });
};

const T = await import("../build/craft/target.js");
const O = await import("../build/craft/odds.js");
const F = await import("../build/craft/facts.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();

test("bench room: craft types that fit, one craft per item, multimod (problem #10)", async () => {
  const { benchRoom } = await import("../build/craft/plan.js");
  const bow = benchRoom({ Prefix: 0, Suffix: 1 }, [{ type: "Suffix", source: "bench", lines: ["10% increased Attack Speed"] }]);
  assert.equal(bow.fits("Prefix"), false, "no open prefix; removing the crafted suffix frees a suffix only");
  assert.equal(bow.fits("Suffix"), true);
  assert.match(bow.note("Suffix"), /^replaces "10% increased Attack Speed"/);
  const quiver = benchRoom({ Prefix: 0, Suffix: 0 }, [{ type: "Prefix", source: "bench", lines: ["Adds 23 to 40 Fire Damage to Attacks"] }]);
  assert.deepEqual([quiver.fits("Prefix"), quiver.fits("Suffix")], [true, false]);
  const swap = benchRoom({ Prefix: 0, Suffix: 1 }, [{ type: "Prefix", source: "bench", lines: ["+30 to maximum Mana"] }]);
  assert.match(swap.note("Suffix"), /after removing "\+30 to maximum Mana"; one bench craft per item/);
  const none = benchRoom({ Prefix: 0, Suffix: 0 }, [{ type: "Prefix", source: "explicit" }]);
  assert.deepEqual([none.fits("Prefix"), none.fits("Suffix")], [false, false]);
  const multi = benchRoom({ Prefix: 1, Suffix: 0 }, [{ type: "Suffix", source: "bench", lines: ["Can have up to 3 Crafted Modifiers"] }, { type: "Prefix", source: "bench", lines: ["+30 to maximum Mana"] }]);
  assert.equal(multi.multimod, true);
  assert.deepEqual([multi.fits("Prefix"), multi.fits("Suffix")], [true, false], "multimod: open slots only, nothing replaced");
  assert.equal(multi.note("Prefix"), "");
  assert.match(F.cite("oneCraft"), /only one crafted modifier/);
});

test("targets: player words to wants (counts, minimum values, tiers)", () => {
  const w = T.parseWants("a ring with life, 2 res, crit multi");
  assert.equal(w.length, 3);
  assert.equal(w[0].alts[0].label, "maximum Life");
  assert.equal(w[1].count, 2);
  assert.deepEqual(w[1].alts.map((a) => a.label), ["Fire Resistance", "Cold Resistance", "Lightning Resistance"]);
  assert.match(w[2].alts[0].label, /Critical Strike Multiplier/);
  assert.equal(T.parseWant("life 70+").min, 70);
  assert.equal(T.parseWant("70+ life").min, 70);
  assert.equal(T.parseWant("T1 life").maxTier, 1);
  assert.ok(T.parseWant("+1 to Level of all Minion Skill Gems").alts[0].re.test("+# to level of all minion skill gems"));
  assert.equal(T.template("+(80-89) to maximum Life"), "+# to maximum life");
  assert.equal(T.atRoll("+(16-20)% to Cold Resistance"), "+18% to Cold Resistance");
  // A partial tier counts by the share of its range that reaches the number.
  const want = T.parseWant("life 85+");
  assert.equal(T.share(["+(80-89) to maximum Life"], want.alts[0], want, true), 0.5);
  assert.equal(T.share(["+(90-99) to maximum Life"], want.alts[0], want, true), 1);
  assert.equal(T.share(["+(80-84) to maximum Life"], want.alts[0], want, true), 0);
});

test("odds: weights, one mod per group, prefix/suffix limits", () => {
  const wants = [T.parseWant("life"), T.parseWant("fire res")];
  const mods = [
    { type: "Prefix", group: "Life", weight: 1000 }, { type: "Prefix", group: "Mana", weight: 3000 },
    { type: "Suffix", group: "Fire", weight: 1000 }, { type: "Suffix", group: "Cold", weight: 1000 },
  ];
  const hits = [[{ want: 0, alt: 0, share: 1 }], [], [{ want: 1, alt: 0, share: 1 }], []];
  const a = O.altOdds(mods, hits, wants, 2);
  assert.ok(Math.abs(a.p - 0.25 * 0.5) < 0.01, `alteration: 1/4 prefix x 1/2 suffix = 12.5% (got ${a.p})`);
  assert.equal(a.regal, 0, "both wants already on the item");
  const lifeOnly = hits.map((h) => h.filter((x) => x.want === 0));
  const one = O.altOdds(mods, lifeOnly, [wants[0]], 1);
  assert.ok(Math.abs(one.p - 0.25) < 0.01);
  // A rare from this pool always has all four groups (4 mods, 2 + 2 fit): both wants every time.
  const r = O.rareOdds(mods, hits, wants, { n: 4, limit: 3, trials: 2000 });
  assert.equal(r.p, 1);
  // With a limit of 1 per type a rare can only take 1 prefix: life 1/4 of the time.
  const r1 = O.rareOdds(mods, lifeOnly, [wants[0]], { n: 2, limit: 1, trials: 8000 });
  assert.ok(Math.abs(r1.p - 0.25) < 0.02, `got ${r1.p}`);
  // Bench: the one missing want is added when its side has room.
  const rb = O.rareOdds(mods, hits, wants, { n: 1, limit: 3, trials: 4000, bench: [{ want: 1, alt: 0, type: "Suffix", share: 1 }] });
  assert.ok(rb.pBench > rb.p);
  assert.equal(O.triesFor(0.5, 0.5), 1);
  assert.equal(O.triesFor(0.1, 0.9), 22);
  assert.deepEqual(O.RARE_COUNTS.map(([n]) => n), [4, 5, 6]);
  assert.ok(Math.abs(O.RARE_COUNTS.reduce((s, [, w]) => s + w, 0) - 1) < 1e-9);
});

test("facts: every crafting rule has a quote, link, version and date", () => {
  for (const f of Object.values(F.FACTS)) {
    assert.ok(f.quote.length > 10 && f.quote.length < 260, f.id);
    assert.match(f.url, /^https:\/\/(www\.poewiki\.net|www\.pathofexile\.com)\//, f.id);
    assert.match(f.version, /^3\.\d+/, f.id);
    assert.match(f.read, /^\d{4}-\d{2}-\d{2}$/, f.id);
  }
  assert.match(F.cite("rareCount"), /8:3:1.*may be outdated/);
  assert.match(F.UNKNOWN.fossilWeights, /not computed/);
});

let link;
async function ok(name, args = {}) {
  const r = await runTool(tools, context, name, args);
  assert.equal(r.isError, false, `${name} failed: ${r.text}`);
  return r.text;
}
function fakeTrade() {
  return {
    requests: 0, queries: [],
    async searchItems(league, q) {
      this.requests++;
      this.queries.push(q);
      assert.equal(q.query.status.option, "securable", "instant buyout only");
      return { id: "fake-craft", result: ["c1", "c2", "c3"], total: 3 };
    },
    async fetchItems(ids) {
      this.requests++;
      return ids.map((id, i) => ({
        id, listing: { price: { amount: 40 + i * 5, currency: "chaos" }, indexed: new Date().toISOString(), account: { name: "Seller" } },
        item: { id, name: "Test Loop", typeLine: "Paua Ring", baseType: "Paua Ring", frameType: 2, ilvl: 84, rarity: "Rare",
          implicitMods: ["+25 to maximum Mana"], explicitMods: ["+80 to maximum Life", "+40% to Fire Resistance", "+40% to Cold Resistance"] },
      }));
    },
    beginCall() {},
    async getLeagues() { throw new Error("not used"); },
  };
}

describe("headless (fixture build)", () => {
  before(async () => {
    await ok("open_build", { name: "occ-vortex" });
    link = await context.pob.link();
  });
  after(() => context.pob.close());

  test("craft_pool: PoB's spawn weights, tiers and item level for a base", async () => {
    const p = (await link.call("craft_pool", { slot: "Ring 1" })).result;
    assert.equal(p.base, "Paua Ring");
    assert.equal(p.class, "Ring");
    assert.equal(p.ilvl, 84);
    assert.equal(p.limit, 3);
    assert.ok(p.mods.length > 50 && p.mods.every((m) => m.weight > 0 && m.level <= 84 && m.tier >= 1 && m.tier <= m.tiers));
    const life = p.mods.filter((m) => /^\+\(\d+-\d+\) to maximum Life$/.test(m.lines[0]));
    assert.ok(life.length >= 3 && life.every((m) => m.type === "Prefix" && m.trade.length));
    assert.ok(p.bench.length > 0 && p.essences.length > 0);
    const low = (await link.call("craft_pool", { base: "Paua Ring", ilvl: 30 })).result;
    assert.ok(low.mods.every((m) => m.level <= 30) && low.mods.length < p.mods.length, "item level limits the pool");
    const bad = await link.call("craft_pool", { base: "Paua" }).catch((e) => e);
    assert.match(String(bad.message ?? bad.error ?? bad), /did you mean: .*Paua Ring/);
    const sh = (await link.call("craft_pool", { base: "Paua Ring", influence: "shaper" })).result;
    assert.ok(sh.mods.some((m) => m.influence) && !p.mods.some((m) => m.influence), "influence adds its own mods");
  });

  test("SSF craft plan: methods by effort, steps, stop points, sources, no trade", async () => {
    setProfile({ playMode: "ssf", league: "", currency: { chaos: 0, divine: 0 } });
    const trade = fakeTrade();
    const { craftPlan } = await import("../build/craft/plan.js");
    const t0 = Date.now();
    const r = await craftPlan({ pob: context.pob, trade }, { craft: "life, 2 res", slot: "Ring 1" });
    assert.ok(Date.now() - t0 < 30_000);
    assert.equal(trade.requests, 0, "SSF: no trade request");
    assert.match(r.text, /Craft plan: Paua Ring \(Ring\), item level 84 \(assumed/);
    assert.match(r.text, /2 of Fire Resistance \/ Cold Resistance \/ Lightning Resistance/);
    assert.match(r.text, /Chaos Orb spam/);
    assert.match(r.text, /Alteration \+ Regal/);
    assert.match(r.text, /Stop points: 50% of crafters are done within/);
    assert.match(r.text, /Finished item in Ring 1 \(average rolls, PoB\): DPS/);
    assert.match(r.text, /SSF: /);
    assert.doesNotMatch(r.text, /Buy instead/);
    assert.match(r.text, /Sources \(rules the odds rest on\):[\s\S]*poewiki\.net\/wiki\/Modifier/);
    assert.match(r.text, /Unknown or assumed:/);
    assert.match(r.text, /Nothing was crafted or bought/);
    assert.ok(r.best && r.best.pTry > 0);
  });

  test("trade craft plan: poe.ninja prices, buy vs craft with one instant-buyout search", async () => {
    setProfile({ playMode: "trade", league: "Testleague", currency: { chaos: 50, divine: 0 } });
    const trade = fakeTrade();
    const before = (await link.call("key_stats")).stats;
    const { craftPlan } = await import("../build/craft/plan.js");
    const r = await craftPlan({ pob: context.pob, trade }, { craft: "life, 2 res", slot: "Ring 1" });
    assert.ok(trade.requests <= 2, `one search + one fetch (made ${trade.requests})`);
    const q = trade.queries[0];
    assert.equal(q.query.filters.type_filters.filters.category.option, "accessory.ring");
    assert.ok(q.query.stats.some((g) => g.type === "count" && g.value.min === 2), "2 res = a count group");
    assert.match(r.text, /expected ~\d/);
    assert.match(r.text, /Buy instead: 3 instant-buyout listings with all wants; cheapest fair ~40c/);
    assert.match(r.text, /crafting is cheaper|buying is cheaper|about the same/);
    assert.match(r.text, /Your 50c buys about/);
    assert.equal(r.buyChaos, 40);
    assert.deepEqual((await link.call("key_stats")).stats, before, "the build is unchanged");
  });

  test("guide item as the target; wants that cannot roll are named", async () => {
    setProfile({ playMode: "ssf", league: "", currency: { chaos: 0, divine: 0 } });
    const text = await ok("affixes", { craft: "item", slot: "Gloves", item_text: "Rarity: RARE\nTest Grip\nFingerless Silk Gloves\nItem Level: 84\nImplicits: 1\n16% increased Spell Damage\n+92 to maximum Life\n+38% to Fire Resistance" });
    assert.match(text, /\+92 to maximum Life \(tier \d or better\)/);
    assert.match(text, /\+38% to Fire Resistance/);
    assert.match(text, /Essence of Anger/, "an essence guarantees the fire resistance on gloves (PoB data)");
    const no = await ok("affixes", { craft: "life, +1 to level of all minion skill gems", slot: "Ring 1" });
    assert.match(no, /Cannot roll on this base at item level 84: .*minion/i);
    const bad = await runTool(tools, context, "affixes", { craft: "item" });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /needs item_text/);
  });

  test("bench quick fixes: every fitting craft simulated in the slot, build unchanged", async () => {
    const before = (await link.call("key_stats")).stats;
    const text = await ok("affixes", { craft: "fix", slot: "Gloves" });
    assert.match(text, /Bench quick fixes for Gloves/);
    assert.match(text, /1\. (Prefix|Suffix) ".+"( \(.+\))?: DPS [+-]\d/);
    assert.match(text, /already has a bench craft/);
    assert.deepEqual((await link.call("key_stats")).stats, before);
    const missing = await runTool(tools, context, "affixes", { craft: "fix" });
    assert.match(missing.text, /needs slot/);
  });

  // Problem #10: a craft only fits an open affix of its type, or the one the current craft frees.
  test("bench quick fixes: only crafts whose prefix/suffix type fits (made-up items)", async () => {
    const fixLines = (text) => text.split("\n").filter((l) => /^\d+\. (Prefix|Suffix) /.test(l));
    const equip = async (slot, text) => assert.match(await ok("edit", { ops: [{ op: "equip", slot, text }] }), /ok equip/);
    // Crafted prefix, 1 open prefix, suffixes full: prefix crafts only, each replacing the old craft.
    await equip("Ring 2", "Rarity: RARE\nTest Band\nTwo-Stone Ring\nItem Level: 84\nImplicits: 1\n+15% to Fire and Cold Resistances\n+74 to maximum Life\n{crafted}+30 to maximum Mana\n+41% to Lightning Resistance\n+35% to Chaos Resistance\n+40 to Strength");
    const ring = await ok("affixes", { craft: "fix", slot: "Ring 2" });
    assert.match(ring, /open prefixes 1, open suffixes 0/);
    assert.match(ring, /only prefix crafts fit/);
    assert.ok(fixLines(ring).length > 0, ring);
    for (const l of fixLines(ring)) assert.match(l, /^\d+\. Prefix .*\(replaces "\+30 to maximum Mana"\)/, l);
    // Prefixes full, crafted suffix, 1 open suffix: suffix crafts only (like the bow in the report).
    await equip("Gloves", "Rarity: RARE\nTest Mitts\nFingerless Silk Gloves\nItem Level: 84\nImplicits: 1\n16% increased Spell Damage\n+92 to maximum Life\n+30 to maximum Mana\n+40 to maximum Energy Shield\n+38% to Fire Resistance\n{crafted}+30% to Cold Resistance");
    const gloves = await ok("affixes", { craft: "fix", slot: "Gloves" });
    assert.match(gloves, /open prefixes 0, open suffixes 1/);
    assert.ok(fixLines(gloves).length > 0, gloves);
    for (const l of fixLines(gloves)) assert.match(l, /^\d+\. Suffix /, l);
    // No craft, prefixes full: suffix crafts in the open suffixes, nothing "replaces".
    await equip("Ring 2", "Rarity: RARE\nTest Loop\nTwo-Stone Ring\nItem Level: 84\nImplicits: 1\n+15% to Fire and Cold Resistances\n+74 to maximum Life\n+30 to maximum Mana\n+40 to maximum Energy Shield\n+41% to Lightning Resistance");
    const plain = await ok("affixes", { craft: "fix", slot: "Ring 2" });
    assert.match(plain, /open prefixes 0, open suffixes 2/);
    assert.ok(fixLines(plain).length > 0 && fixLines(plain).every((l) => /^\d+\. Suffix /.test(l) && !/replaces|removing/.test(l)), plain);
  });

  test("read-only chat: craft plans are allowed (they change nothing)", async () => {
    process.env.POB_READ_ONLY = "1";
    try {
      const r = await runTool(tools, context, "affixes", { craft: "life", slot: "Ring 1" });
      assert.equal(r.isError, false, r.text);
    } finally { delete process.env.POB_READ_ONLY; }
  });
});
