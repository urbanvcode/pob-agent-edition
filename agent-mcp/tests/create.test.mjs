// "Create a build" tests (roadmap Stage 11): the preference interview in the
// shared profile (TS and Lua), poe.ninja's protobuf / NDIC build data, discover,
// a NEW build from a template, theorycraft (patch ideas, the skill swapped into
// the nearest real build), close-enough item targets, roll ranges, cost per stage
// and the read-only guard. Offline: poe.ninja, the trade site and the patch notes
// are faked, PoB runs headless on a fixture build. No window; nothing is written
// to the player's Documents. Names below are made up.
// Run with: npm test
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-create-"));
const builds = path.join(tmp, "Builds");
fs.mkdirSync(builds);
const fixture = path.join(here, "fixtures", "occ-vortex.xml");
fs.copyFileSync(fixture, path.join(builds, "occ-vortex.xml"));
const settings = path.join(tmp, "AgentEdition.json");
process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = builds;
process.env.POB_AGENT_SETTINGS = settings;
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";
const setProfile = (profile) => fs.writeFileSync(settings, JSON.stringify({ profile }));
setProfile({ playMode: "trade", league: "Testleague", currency: { chaos: 100, divine: 1 } });

const { encodeBuildCode } = await import("../build/tools/session.js");
const NB = await import("../build/create/ninjaBuilds.js");
const B = await import("../build/create/build.js");
const TG = await import("../build/create/targets.js");
const P = await import("../build/profile.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();

// --- protobuf and NDIC writers (the shapes poe.ninja serves) ------------------------
const vint = (n) => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n); return Buffer.from(out); };
const fld = (f, v) => (typeof v === "number" ? Buffer.concat([vint(f * 8), vint(v)]) : ((b) => Buffer.concat([vint(f * 8 + 2), vint(b.length), b]))(Buffer.isBuffer(v) ? v : Buffer.from(v)));
const msg = (...parts) => Buffer.concat(parts);
function ndic(names) {
  const chunks = Math.ceil(names.length / 16);
  const head = Buffer.alloc(36 + 8 * chunks);
  head.write("NDIC", 0, "latin1"); head.writeUInt32LE(2, 4); head.writeUInt32LE(names.length, 12); head.writeUInt32LE(16, 24); head.writeUInt32LE(chunks, 28); head.writeUInt32LE(names.length, 32);
  let off = 0;
  for (let c = 0; c < chunks; c++) {
    head.writeUInt32LE(off, 36 + 8 * c); head.writeUInt32LE(c * 16, 40 + 8 * c);
    for (const nm of names.slice(c * 16, c * 16 + 16)) off += Buffer.byteLength(nm);
  }
  return Buffer.concat([head, Buffer.from(names.map((nm) => Buffer.byteLength(nm))), Buffer.from(names.join(""))]);
}
const HASH = { class: "a".repeat(40), gem: "b".repeat(40), item: "c".repeat(40) };
const DICT = { class: ["Necromancer", "Occultist", "Witch"], gem: ["Cold Snap", "Raise Zombie", "Vortex"], item: ["Heretic's Veil", "Rare Boots"] };
const dim = (id, dict, counts) => fld(2, msg(fld(1, id), fld(2, dict), ...counts.map(([i, c]) => fld(3, msg(i ? fld(1, i) : Buffer.alloc(0), fld(2, c))))));
function search({ total, classes, skills, items, chars }) {
  return fld(1, msg(
    fld(1, total), dim("class", "class", classes), dim("skills", "gem", skills), dim("items", "item", items),
    ...Object.entries(HASH).map(([k, h]) => fld(6, msg(fld(1, k), fld(2, h)))),
    fld(12, msg(fld(1, "name"), fld(2, "name"), ...chars.map((c) => fld(7, c.name)))),
    fld(12, msg(fld(1, "account"), fld(2, "account"), ...chars.map((c) => fld(7, c.account)))),
    fld(12, msg(fld(1, "class"), fld(2, "class"), fld(6, Buffer.concat(chars.map((c) => vint(c.cls)))), fld(11, "class"))),
  ));
}
const CHARS = [{ name: "TestCharOne", account: "TestAccount-0001", cls: 1 }, { name: "TestCharTwo", account: "TestAccount-0002", cls: 2 }, { name: "TestCharThree", account: "TestAccount-0003", cls: 1 }];

// --- fake poe.ninja (builds and economy) --------------------------------------------
const fixtureCode = encodeBuildCode(fs.readFileSync(fixture, "utf8"));
const calls = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  if (!u.startsWith("https://poe.ninja/")) throw new Error(`test made an unexpected request: ${u}`);
  const q = new URL(u).searchParams;
  if (u.includes("/data/index-state")) return Response.json({ snapshotVersions: [{ url: "testleague", type: "exp", name: "Testleague", version: "0001-test" }] });
  if (u.includes("/builds/dictionary/")) {
    const kind = Object.keys(HASH).find((k) => u.endsWith(HASH[k]));
    return new Response(ndic(DICT[kind]));
  }
  if (u.includes("/builds/0001-test/search")) {
    const skill = q.get("skills");
    if (skill === "Raise Zombie") return new Response(search({ total: 0, classes: [], skills: [], items: [], chars: [] }));
    if (skill) return new Response(search({ total: 40, classes: [[1, 30], [2, 10]], skills: [[2, 40]], items: [[0, 30], [1, 40]], chars: CHARS }));
    return new Response(search({ total: 1000, classes: [[0, 100], [1, 500], [2, 400]], skills: [[0, 30], [2, 50]], items: [[0, 300], [1, 900]], chars: CHARS }));
  }
  if (u.includes("/builds/0001-test/character")) return Response.json({ pathOfBuildingExport: fixtureCode, level: 95, class: "Occultist", ascendancyClassName: "Occultist" });
  if (u.includes("type=Currency")) return Response.json({ lines: [{ currencyTypeName: "Divine Orb", chaosEquivalent: 200 }] });
  const type = q.get("type");
  if (type === "UniqueArmour") return Response.json({ lines: [{ id: 1, name: "Heretic's Veil", baseType: "Deicide Mask", chaosValue: 42 }] });
  if (type === "SkillGem") return Response.json({ lines: [{ id: 2, name: "Vortex", gemLevel: 20, gemQuality: 20, chaosValue: 3 }] });
  return Response.json({ lines: [] });
};

// --- fake trade site (instant buyout listings) ----------------------------------------
function fakeTrade() {
  return {
    requests: 0, queries: [],
    async searchItems(league, q) {
      this.requests++;
      this.queries.push(q);
      assert.equal(q.query.status.option, "securable", "instant buyout only");
      return { id: "fake-close", result: ["r1", "r2"], total: 2 };
    },
    async fetchItems(ids) {
      this.requests++;
      return ids.map((id, i) => ({
        id, listing: { price: { amount: 10 + i * 20, currency: "chaos" }, indexed: new Date().toISOString(), account: { name: "Seller" } },
        item: { id, name: "Test Band", typeLine: "Paua Ring", baseType: "Paua Ring", frameType: 2, ilvl: 84, rarity: "Rare",
          implicitMods: ["+25 to maximum Mana"], explicitMods: ["+60 to maximum Life", `+${35 + i * 8}% to Lightning Resistance`, "+12% to Fire Resistance"] },
      }));
    },
    beginCall() {},
    async getLeagues() { throw new Error("not used"); },
  };
}

async function ok(args) {
  const r = await runTool(tools, context, "build_create", args);
  assert.equal(r.isError, false, r.text);
  return r.text;
}

test("poe.ninja readers: NDIC names, protobuf counts and top characters; unknown formats are refused", () => {
  const names = Array.from({ length: 20 }, (_, i) => `Name ${i}`);
  assert.deepEqual(NB.parseDictionary(ndic(names)), names);
  assert.throws(() => NB.parseDictionary(Buffer.from("XXXX0000000000000000000000000000000000")), /unknown format/);
  const s = NB.parseSearch(search({ total: 7, classes: [[0, 3], [1, 4]], skills: [], items: [], chars: CHARS }));
  assert.equal(s.total, 7);
  assert.deepEqual(s.dimensions.find((d) => d.id === "class").counts, [[0, 3], [1, 4]]);
  assert.equal(s.dictionaries.gem, HASH.gem);
  assert.deepEqual(s.characters.map((c) => c.classIndex), [1, 2, 1]);
  assert.throws(() => NB.parseSearch(Buffer.from([0x08, 0x01])), /unknown format/);
});

test("interview: questions, answers saved in the shared profile, unknown fields ignored", async () => {
  assert.match(await ok({ interview: true }), /playstyle: .*melee, ranged/);
  const saved = await ok({ answers: { playstyle: ["Spells", "nonsense"], defence: "tanky", novelty: "proven", exclude: ["minions"], hours: 9.6, budget: "2 div", playMode: "mixed", bogus: 1 } });
  assert.match(saved, /spells \| defence tanky/);
  assert.match(saved, /ignored\): bogus/);
  const p = P.getProfile().profile;
  assert.deepEqual(p.preferences.playstyle, ["spells"]);
  assert.equal(p.preferences.hours, 10);
  assert.equal(p.playMode, "mixed");
  assert.match(await ok({ interview: true }), /defence: .*\[now: tanky\]/);
  assert.match((await runTool(tools, context, "profile", {})).text, /Build preferences: spells/);
  // A normal profile change keeps the answers.
  P.updateProfile({ league: "Testleague" });
  assert.equal(P.getProfile().profile.preferences.defence, "tanky");
});

test("interview: PoB's Settings.lua keeps the answers when the Options window saves the profile", () => {
  const exe = path.join(root, "luajit", process.platform === "win32" ? "luajit.exe" : "luajit");
  const dir = fs.mkdtempSync(path.join(tmp, "lua-"));
  fs.writeFileSync(path.join(dir, "AgentEdition.json"), JSON.stringify({ profile: { playMode: "ssf", preferences: { playstyle: ["minions", "bogus"], defence: "glass", hours: 5, exclude: ["traps"] } } }));
  const script = `package.path = ${JSON.stringify(path.join(root, "PathOfBuilding", "runtime", "lua", "?.lua").replace(/\\/g, "/"))} .. ";" .. package.path
local S = dofile(${JSON.stringify(path.join(root, "PathOfBuilding", "src", "Agent", "Settings.lua").replace(/\\/g, "/"))})
S.setProfile(${JSON.stringify(dir.replace(/\\/g, "/") + "/")}, { league = "Testleague" })`;
  const r = spawnSync(exe, ["-e", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(fs.readFileSync(path.join(dir, "AgentEdition.json"), "utf8")).profile;
  assert.equal(p.league, "Testleague");
  assert.deepEqual(p.preferences.playstyle, ["minions"]);
  assert.equal(p.preferences.defence, "glass");
  assert.deepEqual(p.preferences.exclude, ["traps"]);
  assert.deepEqual(P.normalizePreferences(p.preferences), { ...P.normalizePreferences(p.preferences), playstyle: ["minions"], hours: 5 });
  // Both sides offer the same choices.
  const lua = fs.readFileSync(path.join(root, "PathOfBuilding", "src", "Agent", "Settings.lua"), "utf8");
  for (const [k, list] of Object.entries(P.PREFERENCE_CHOICES)) assert.ok(lua.includes(`${k} = { ${list.map((v) => `"${v}"`).join(", ")} }`), `Settings.lua ${k}`);
  assert.ok(lua.includes(`{ ${P.PLAYSTYLES.map((v) => `"${v}"`).join(", ")} }`), "Settings.lua playstyles");
});

test("ranking: playstyle, exclusions, likes and novelty", () => {
  const tags = { A: { styles: ["spells", "hits"] }, B: { styles: ["minions", "spells"] }, C: { styles: ["melee", "hits"] }, S: { styles: [], support: true } };
  const skills = [{ name: "A", count: 500 }, { name: "B", count: 300 }, { name: "C", count: 50 }, { name: "S", count: 900 }];
  const prefs = P.normalizePreferences({ playstyle: ["spells"], exclude: ["minions"] });
  const r = B.rankSkills(skills, 1000, tags, prefs);
  assert.deepEqual(r.map((o) => o.skill), ["A"], "B is a minion skill (excluded), C is not a spell, S is a support");
  const liked = B.rankSkills(skills, 1000, tags, P.normalizePreferences({ likes: ["C"] }));
  assert.equal(liked[0].skill, "C");
  const fresh = B.rankSkills(skills, 1000, tags, P.normalizePreferences({ novelty: "new" }));
  assert.equal(fresh[0].skill, "C", "new = the least played skill with enough characters");
  assert.deepEqual(B.stylesIn("minions and ignite"), ["minions", "dot"]);
});

test("discover: poe.ninja builds that fit the answers, with classes, uniques and today's prices", async () => {
  setProfile({ playMode: "trade", league: "Testleague", currency: { chaos: 100, divine: 1 }, preferences: { playstyle: ["spells"] } });
  const text = await ok({});
  assert.match(text, /Builds on poe\.ninja for Testleague: 1,000 characters/);
  assert.match(text, /1\. Vortex: 50 characters \(5\.0%\)/);
  assert.match(text, /Classes: Occultist 75\.0%, Witch 25\.0%/);
  assert.match(text, /Heretic's Veil 75\.0% ~42c/);
  assert.doesNotMatch(text, /Rare Boots/, "plain item kinds are not uniques");
  assert.match(text, /Make it: build_create \{ skill: "Vortex" \}/);
  assert.match(text, /not measured/);
});

test("create: a NEW build from a top character, candidates simulated, the player's builds untouched", async () => {
  const before = fs.readFileSync(path.join(builds, "occ-vortex.xml"), "utf8");
  const text = await ok({ skill: "Vortex" });
  assert.match(text, /Saved a NEW build "New build - Vortex Occultist"/);
  assert.match(text, /\[chosen\] Occultist lvl \d+: DPS [\d,]+/);
  assert.match(text, /Config assumptions:/);
  assert.match(text, /PoB does NOT model|PoB reads every/);
  const file = path.join(builds, "New build - Vortex Occultist.xml");
  assert.ok(fs.existsSync(file));
  assert.match(fs.readFileSync(file, "utf8"), /Template from a real character\. Created by PoB Agent Edition/);
  assert.equal(fs.readFileSync(path.join(builds, "occ-vortex.xml"), "utf8"), before, "the player's build file is untouched");
  // Again: a second file, never an overwrite.
  assert.match(await ok({ skill: "Vortex" }), /"New build - Vortex Occultist \(2\)"/);
  const unknown = await runTool(tools, context, "build_create", { skill: "Not A Real Gem" });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /PoB has no gem named/);
});

test("theorycraft: cited patch lines, usage on poe.ninja, then the skill swapped into the nearest real build", async () => {
  const thread = { title: "Content Update 3.30.0", url: "https://www.pathofexile.com/forum/view-thread/1", version: "3.30.0", posted_at: "2026-11-11T00:00:00Z", retrieved_at: "2026-11-13T00:00:00Z" };
  B.useKnowledge({
    fetcher: { beginCall() {} },
    async patch(o) {
      assert.equal(o.filter, "minions");
      return {
        version: { current: { version: "3.30.0", released: "2026-11-13" }, fact: { source: "ggg", url: thread.url, retrieved_at: thread.retrieved_at } },
        scope: "3.30", threads: [thread], sections: [], unmatched: [], notes: [],
        facts: [{ source: "ggg", title: `${thread.title} > Skill Gem Changes`, text: "Raise Zombie now grants minions 10% more Damage (test line).", url: thread.url, game: "poe1", game_version: "3.30.0", retrieved_at: thread.retrieved_at, kind: "patch" }],
      };
    },
  });
  const ideas = await ok({ theorycraft: "minions" });
  assert.match(ideas, /THEORYCRAFT, NOT TESTED BY PLAYERS/);
  assert.match(ideas, /"Raise Zombie now grants minions/);
  assert.match(ideas, /Raise Zombie 0 \(nobody yet\)/);
  assert.match(ideas, /build_create \{ theorycraft: "minions", skill: "Raise Zombie" \}/);

  const made = await ok({ theorycraft: "minions", skill: "Raise Zombie" });
  assert.match(made, /^Nobody on poe\.ninja uses Raise Zombie yet\. Template: the nearest real build, Vortex/);
  assert.match(made, /THEORYCRAFT, NOT TESTED BY PLAYERS\. Saved a NEW build "Theorycraft - Raise Zombie Occultist"/);
  assert.match(made, /After the swap: DPS/);
  const xml = fs.readFileSync(path.join(builds, "Theorycraft - Raise Zombie Occultist.xml"), "utf8");
  assert.match(xml, /THEORYCRAFT, NOT TESTED BY PLAYERS/);
  assert.match(xml, /nameSpec="Raise Zombie"/);
  assert.doesNotMatch(await ok({ skill: "Vortex" }), /THEORYCRAFT/, "a template build is not labelled theorycraft");
});

test("targets: every rare's must/nice stats from PoB, close listings simulated, craft option, roll ranges", async () => {
  await runTool(tools, context, "open_build", { name: "occ-vortex" });
  const link = await context.pob.link();
  const before = (await link.call("key_stats")).stats;
  const realTrade = context.trade;
  const trade = fakeTrade();
  context.trade = trade;
  try {
    const text = await ok({ targets: true, slot: "Ring 1" });
    assert.match(text, /Ring 1: Hate Band \(Paua Ring\) - worth [\d.]+ points/);
    assert.match(text, /Must have: .*Lightning Resistance \(total\)/);
    assert.match(text, /\d+% of the target for 10 chaos/);
    assert.match(text, /Craft it/);
    assert.match(text, /advisor rules, not game facts/);
    const q = trade.queries[0];
    assert.equal(q.query.stats[0].type, "and");
    assert.ok(q.query.stats[0].filters.every((f) => f.id.startsWith("pseudo.") || f.id.startsWith("explicit.")));
    assert.ok(trade.requests <= 4, `polite: ${trade.requests} trade requests for one slot`);
    // Several slots: only the most valuable ones are searched.
    const many = await ok({ targets: true, limit: 1 });
    assert.ok(trade.requests <= 8);
    assert.match(many, /Search: build_create \{ targets: true, slot: "/);
    assert.doesNotMatch(many, /\+0\+/, "a +1 stat is never asked for at 0");
    // The fixture's unique (Heretic's Veil) has fixed rolls: no roll advice for it.
    assert.doesNotMatch(many, /Heretic's Veil: /);
  } finally { context.trade = realTrade; }
  assert.deepEqual((await link.call("key_stats")).stats, before, "targets never change the build");

  // SSF: no trade at all, the must-haves as loot and craft targets.
  setProfile({ playMode: "ssf", league: "Testleague", currency: { chaos: 0, divine: 0 } });
  const ssfTrade = fakeTrade();
  context.trade = ssfTrade;
  try {
    assert.match(await ok({ targets: true, slot: "Ring 1" }), /\[SSF\] keep a drop with the must-haves; craft it: affixes \{ craft: ".*lightning resistance \d+\+/);
    assert.equal(ssfTrade.requests, 0);
  } finally { context.trade = realTrade; setProfile({ playMode: "trade", league: "Testleague", currency: { chaos: 100, divine: 1 } }); }
});

test("targets maths: pseudo totals, worth, roll advice", () => {
  assert.deepEqual(TG.pseudoParts("+12% to Fire and Cold Resistances"), [["fire", 12], ["cold", 12]]);
  assert.deepEqual(TG.pseudoParts("+10% to all Elemental Resistances").map((p) => p[0]), ["fire", "cold", "lightning"]);
  assert.deepEqual(TG.pseudoParts("+70 to maximum Life"), [["life", 70]]);
  assert.equal(TG.lineAmount("Adds 10 to 20 Physical Damage to Attacks"), 15);
  const base = { FullDPS: 100, TotalEHP: 1000, MissingFireResist: 20 };
  assert.ok(TG.worth(base, { FullDPS: 110, TotalEHP: 1000, MissingFireResist: 0 }, "balanced") > TG.worth(base, { FullDPS: 110, TotalEHP: 1000, MissingFireResist: 20 }, "balanced"));
  const line = { text: "+(80-100) to maximum Life", now: "+90 to maximum Life", low: "+80 to maximum Life", high: "+100 to maximum Life",
    lowStats: { FullDPS: 100, TotalEHP: 960 }, highStats: { FullDPS: 100, TotalEHP: 1000 } };
  assert.match(TG.rollAdvice(line, "balanced"), /good enough: 95 or more/);
  assert.match(TG.rollAdvice({ ...line, lowStats: { FullDPS: 100, TotalEHP: 995 } }, "balanced"), /any roll is fine/);
  const t = TG.makeTarget({ slot: "Ring 1", kind: "rare", name: "X", category: "accessory.ring", plain: { FullDPS: 100, TotalEHP: 1000 }, target: { FullDPS: 100, TotalEHP: 1100 },
    lines: [{ text: "+90 to maximum Life", without: { FullDPS: 100, TotalEHP: 1010 } }, { text: "+10 to Strength", without: { FullDPS: 100, TotalEHP: 1095 } }] }, "balanced");
  assert.equal(t.must[0].key, "life");
  assert.equal(t.must[0].min, 67, "75% of the roll (advisor rule)");
  assert.equal(TG.targetQuery(t, false).query.stats[0].filters[0].id, "pseudo.pseudo_total_life");
});

test("targets: a unique with variable rolls gets a good-enough roll from PoB (side engine)", async () => {
  const side = await context.pob.sideLink();
  await side.call("load_build_xml", { xml: fs.readFileSync(fixture, "utf8"), name: "Rolls" });
  const ring = ["Rarity: UNIQUE", "Test Roll Ring", "Paua Ring", "Implicits: 1", "+(20-25) to maximum Mana", "+(30-60) to maximum Life", "+(10-40)% to Lightning Resistance"].join("\n");
  const eq = await side.call("edit", { ops: [{ op: "equip", slot: "Ring 1", text: ring }] });
  assert.ok(!eq.failed || !eq.failed.length, JSON.stringify(eq.results));
  const [u] = (await side.call("create_targets", { slots: ["Ring 1"] })).result;
  assert.equal(u.kind, "unique");
  assert.equal(u.lines.length, 2, "both ranged lines");
  const res = u.lines.find((l) => /Lightning/.test(l.text));
  assert.equal(res.low, "+10% to Lightning Resistance");
  assert.equal(res.high, "+40% to Lightning Resistance");
  const advice = TG.rollAdvice(res, "balanced");
  assert.match(advice, /Lightning Resistance.*(good enough: \d+ or more|any roll is fine)/);
});

test("prices: cost per item set from poe.ninja and the last close-enough search, dated", async () => {
  const text = await ok({ prices: true });
  assert.match(text, /Cost per stage of occ-vortex .*league Testleague, checked \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
  assert.match(text, /Item Set 1 \(active\): ~\d+c/);
  assert.match(text, /Heretic's Veil 42c/);
  assert.match(text, /Ring 1 rare ~10c \(\d+% of the target\)/);
});

test("read-only chat: making a build is refused, everything else is allowed", async () => {
  process.env.POB_READ_ONLY = "1";
  try {
    const r = await runTool(tools, context, "build_create", { skill: "Vortex" });
    assert.equal(r.isError, true);
    assert.match(r.text, /Edits are off/);
    assert.equal((await runTool(tools, context, "build_create", { interview: true })).isError, false);
    assert.equal((await runTool(tools, context, "build_create", { prices: true })).isError, false);
  } finally { delete process.env.POB_READ_ONLY; }
  assert.ok(calls.every((u) => u.startsWith("https://poe.ninja/")), "only poe.ninja was asked (faked)");
});

// Closed in a last test (after() would wait for the idle headless engines first).
test("close the headless engines", () => context.pob.close());
