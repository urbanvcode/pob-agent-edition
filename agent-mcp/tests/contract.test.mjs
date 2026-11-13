// Contract tests: every non-trade tool against a fixture build in the headless
// engine (needs LuaJIT and the PathOfBuilding fork next to this folder; no network,
// no PoB window, nothing written to the player's Documents). Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-contract-"));
const builds = path.join(tmp, "Builds");
fs.mkdirSync(builds);
fs.copyFileSync(path.join(here, "fixtures", "occ-vortex.xml"), path.join(builds, "occ-vortex.xml"));
process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = builds;
process.env.POB_AGENT_SETTINGS = path.join(tmp, "AgentEdition.json");
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";

const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();
after(() => context.pob.close());

async function call(name, args = {}) {
  const r = await runTool(tools, context, name, args);
  return r;
}
async function ok(name, args = {}) {
  const r = await call(name, args);
  assert.equal(r.isError, false, `${name} failed: ${r.text}`);
  return r.text;
}
async function fails(name, args, pattern) {
  const r = await call(name, args);
  assert.equal(r.isError, true, `${name} should have failed but returned: ${r.text}`);
  assert.match(r.text, pattern);
  return r.text;
}
const number = (text, label) => {
  const m = new RegExp(`${label}:? ([\\d,.]+)`).exec(text);
  assert.ok(m, `no "${label}" in:\n${text}`);
  return Number(m[1].replace(/,/g, ""));
};

test("timeless jewel caches are intact (the headless engine must never zero them)", () => {
  const dir = path.join(here, "..", "..", "PathOfBuilding", "src", "Data", "TimelessJewelData");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".bin"))) {
    assert.ok(fs.statSync(path.join(dir, f)).size > 0, `${f} is empty`);
  }
});

test("session: status, list_builds, open_build", async () => {
  assert.match(await ok("status"), /Mode: headless[\s\S]*No build loaded/);
  await fails("diagnose", {}, /list_builds then open_build/);
  assert.match(await ok("list_builds"), /- occ-vortex \(/);
  await fails("open_build", { name: "nope" }, /No build named "nope"/);
  await fails("open_build", {}, /Give name/);
  assert.match(await ok("open_build", { name: "occ-vortex" }), /Loaded "occ-vortex" in the headless engine/);
  const status = await ok("status");
  assert.match(status, /Build: occ-vortex/);
  assert.match(status, /Player profile:/);
  assert.match(await ok("set_view", { view: "TREE" }), /headless/);
  assert.match(await ok("open_options"), /No PoB window/);
});

test("profile tools", async () => {
  assert.match(await ok("profile_get"), /No profile saved yet[\s\S]*How to answer/);
  assert.match(await ok("profile_set", { explanationMode: "deep", currency: { chaos: 250 } }), /Profile updated: explanationMode, currency[\s\S]*DEEP DIVE/);
  await fails("profile_set", { playMode: "x" }, /playMode must be one of/);
  assert.match(await ok("profile_mark_learned", { topics: ["flasks"] }), /Marked as explained: flasks/);
  await ok("profile_set", { explanationMode: "teach" });
});

test("read: build_summary, stats, diagnose, tree_search", async () => {
  const summary = await ok("build_summary");
  assert.match(summary, /level 99 Witch \(Occultist\), main skill Vortex/);
  assert.match(summary, /\[MAIN, Body Armour\].*Vortex 21\/0/);
  assert.match(summary, /Helmet: Heretic's Veil, Deicide Mask \(unique, id \d+\)/);
  assert.match(summary, /TREE \(3_13\): 122 points used/);
  assert.match(summary, /Keystones: Elemental Equilibrium, Elemental Overload/);
  assert.match(summary, /Config assumptions: enemy: pinnacle boss; charges: endurance; flasks on:/);
  assert.ok(!/SKILLS/.test(await ok("build_summary", { parts: ["tree"] })));
  assert.match(await ok("build_summary", { parts: ["items"], detail: true }), /Helmet: .*\n {4}\S/);

  const stats = await ok("stats");
  assert.ok(number(stats, "Combined DPS") > 100000);
  assert.ok(number(stats, "EHP") > 10000);
  assert.match(stats, /Config assumptions:/);
  assert.match(await ok("stats", { match: "MaximumHitTaken" }), /PhysicalMaximumHitTaken: [\d,]+/);
  assert.match(await ok("stats", { fields: ["Life", "Mana"] }), /Life: 6,728\nMana: 1,391/);
  await fails("stats", { match: "zzzz" }, /No PoB stat matches/);

  const d = await ok("diagnose");
  const order = ["FINDINGS", "1. RESISTANCES", "2. SURVIVABILITY", "3. RECOVERY AND MANA", "4. DAMAGE"].map((h) => d.indexOf(h));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), "diagnose sections are out of order");
  assert.match(d, /Fire 75%\/75%/);
  assert.match(d, /weakest: Physical/);
  assert.match(d, /Config assumptions:/);

  const nodes = await ok("tree_search", { query: "cold damage over time", limit: 3 });
  assert.match(nodes, /^\d+ Breath of Rime \[notable; allocated\]/m);
  // The fixture uses the 3.13 tree, which has no masteries.
  assert.match(await ok("tree_search", { query: "life", type: "mastery", limit: 2 }), /No passive node/);
  assert.match(await ok("tree_search", { query: "elemental overload", type: "keystone" }), /Elemental Overload \[keystone; allocated\]/);
  assert.match(await ok("tree_search", { query: "zzzzzz" }), /No passive node/);
});

test("what_if measures and rolls back exactly", async () => {
  const before = await ok("stats");
  const text = await ok("what_if", { ops: [
    { op: "gem", group: 5, gem: 6, level: 1 }, { op: "unequip", slot: "Helmet" }, { op: "flask", index: 2, active: false },
    { op: "config", values: { enemyIsBoss: "Uber", level: 80 } }, { op: "dealloc", nodes: [21460] },
  ] });
  assert.match(text, /ok gem:.*level=1/);
  assert.match(text, /Combined DPS: [\d,.]+ -> [\d,.]+ \(-\d/);
  assert.match(text, /Armour: [\d,.]+ -> [\d,.]+ \(-/, "turning the Granite Flask off must lower armour");
  assert.match(text, /enemy: uber pinnacle boss/);
  assert.match(text, /Rolled back: the build is as it was\./);
  assert.equal(await ok("stats"), before);
  // A failed op with keep: true is rolled back too.
  const failed = await ok("what_if", { keep: true, ops: [{ op: "unequip", slot: "Helmet" }, { op: "equip", slot: "Nope", text: "x" }] });
  assert.match(failed, /FAILED equip: unknown slot "Nope"/);
  assert.match(failed, /keep was ignored because an op failed/);
  assert.equal(await ok("stats"), before);
  await fails("what_if", { ops: [] }, /non-empty list/);
});

test("edit tools change the build and report before/after", async () => {
  await ok("snapshot", { name: "start" });
  const base = await ok("stats");

  const cfg = await ok("set_config", { values: { enemyIsBoss: "None", bogus: 1 } });
  assert.match(cfg, /Set: enemyIsBoss=None/);
  assert.match(cfg, /Rejected: bogus: unknown config option/);
  assert.match(cfg, /Combined DPS: [\d,.]+ -> [\d,.]+ \(\+/);
  assert.match(await ok("set_config", { search: "boss" }), /enemyIsBoss \(list: None \| Boss \| Pinnacle \| Uber\) = None/);

  const items = await ok("edit_items", { ops: [{ op: "equip", slot: "Ring 1", text: "Rarity: RARE\nTest Ring\nTwo-Stone Ring\n+80 to maximum Life\n+40% to Chaos Resistance" }] });
  assert.match(items, /ok equip: .*name=Test Ring, Two-Stone Ring/);
  assert.match(items, /Chaos res %: \d+ -> \d+ \(\+\d+\)/);
  assert.match(items, /save_build with a new name/);
  await fails("edit_items", { ops: [{ op: "alloc", nodes: [1] }] }, /edit_items does not do "alloc"/);

  const skills = await ok("edit_skills", { ops: [{ op: "add_gem", group: 5, name: "Nonexistent Gem" }, { op: "gem", group: 5, gem: 6, level: 20 }] });
  assert.match(skills, /FAILED add_gem: unknown gem "Nonexistent Gem"/);
  assert.match(skills, /ok gem: .*level=20; name=Vortex/);
  assert.match(await ok("edit_skills", { ops: [{ op: "add_group", label: "Test", gems: [{ name: "Frostbite", level: 20 }] }] }), /ok add_group: .*gems=Frostbite/);

  const tree = await ok("edit_tree", { ops: [{ op: "dealloc", nodes: [21460] }] });
  assert.match(tree, /ok dealloc: .*pointsFreed=\d+; removed=Breath of Rime/);
  assert.match(await ok("edit_tree", { ops: [{ op: "alloc", nodes: [21460] }] }), /ok alloc: allocated=Breath of Rime; pointsSpent=\d+/);
  assert.match(await ok("edit_tree", { ops: [{ op: "dealloc", nodes: [99999] }] }), /FAILED dealloc: unknown passive node id 99999[\s\S]*Nothing was changed\./);

  // Saving: never over the player's file by accident.
  await fails("save_build", {}, /would overwrite the player's file/);
  await fails("save_build", { name: "occ-vortex" }, /already exists/);
  assert.match(await ok("save_build", { name: "occ-vortex - AI test" }), /Saved to .*occ-vortex - AI test\.xml/);
  assert.ok(fs.existsSync(path.join(builds, "occ-vortex - AI test.xml")));
  assert.equal(fs.readFileSync(path.join(builds, "occ-vortex.xml"), "utf8"), fs.readFileSync(path.join(here, "fixtures", "occ-vortex.xml"), "utf8"));

  const cmp = await ok("compare", { b: "snapshot:start" });
  assert.match(cmp, /A = current[\s\S]*B = snapshot:start/);
  assert.match(cmp, /Ring 1: Test Ring, Two-Stone Ring {2}-> {2}Hate Band, Paua Ring/);
  assert.match(cmp, /Gems only in A: Frostbite/);
  await fails("compare", { b: "missing build" }, /No build named/);

  assert.match(await ok("restore", { name: "start" }), /Restored snapshot "start"/);
  assert.equal((await ok("stats")).replace(/^.*\n/, ""), base.replace(/^.*\n/, ""));
  await fails("restore", { name: "nope" }, /No snapshot named "nope"/);
  assert.match(await ok("compare", { a: "occ-vortex - AI test", b: "occ-vortex" }), /Ring 1: Test Ring/);
});

test("advice: suggest_passives, anoint, affixes", async () => {
  const s = await ok("suggest_passives", { max_points: 3, limit: 3, focus: "defence" });
  assert.match(s, /Passive suggestions \(defence, within 3 points/);
  assert.match(s, /1\. .* \[id \d+, .*\]: DPS [+-][\d.]+% \| EHP \+[\d.]+%/);
  const a = await ok("anoint", { limit: 3 });
  assert.match(a, /Anoint options for Amulet/);
  assert.match(a, /1\. .*: DPS [+-][\d.]+% \| EHP [+-][\d.]+% \| oils: \w+, \w+, \w+/);
  const tiers = await ok("affixes", { query: "to maximum life", item: "ring", type: "Prefix", limit: 3 });
  assert.match(tiers, /Prefix ".*" \(ilvl \d+, IncreasedLife\): \+\(\d+-\d+\) to maximum Life/);
  assert.match(await ok("affixes", { query: "to maximum life", bench: true, item: "Ring", limit: 2 }), /crafting bench[\s\S]*Prefix "Upgraded"/);
  assert.match(await ok("affixes", { query: "zzzz" }), /No affix matches/);
});

test("suggest_gems: values the current supports, ranks replacements, leaves the build alone", async () => {
  const before = await ok("stats");
  const s = await ok("suggest_gems", { limit: 5 });
  assert.match(s, /Support gems for Vortex \(group 5\): [\d,]+ DPS/);
  assert.match(s, /Current supports, weakest first/);
  const losses = [...s.matchAll(/^- gem \d+ .*: (-[\d.]+)%/gm)].map((m) => Number(m[1]));
  assert.equal(losses.length, 5);
  assert.ok(losses.every((x, i) => i === 0 || x <= losses[i - 1]), "current supports are not sorted weakest first");
  assert.match(s, /Best supports in place of Efficacy \(gem 4\)/);
  const gains = [...s.matchAll(/^\d+\. .*: DPS ([+-][\d.]+)%/gm)].map((m) => Number(m[1]));
  assert.ok(gains.length >= 3 && gains.every((x, i) => i === 0 || x <= gains[i - 1]), "replacements are not sorted by DPS");
  assert.match(s, /\d+ of \d+ fitting supports beat the current setup/);
  // Supports that turn the skill into something else are kept out of the ranking.
  assert.ok(!/^\d+\. Cast when/m.test(s));
  assert.match(await ok("suggest_gems", { add: true, awakened: false, limit: 3 }), /as an extra link/);
  assert.ok(!/^\d+\. Awakened/m.test(await ok("suggest_gems", { awakened: false, limit: 8 })));
  assert.match(await ok("suggest_gems", { limit: 8 }), /^\d+\. Awakened/m);
  await fails("suggest_gems", { group: 99 }, /no skill group 99/);
  // Another group can be checked without changing which skill is the main one.
  assert.match(await ok("suggest_gems", { group: 1, limit: 2 }), /Support gems for Flame Dash \(group 1\)/);
  assert.equal(await ok("stats"), before);
});

test("diagnose with a boss: PoB's boss presets, config restored", async () => {
  const before = await ok("stats");
  const d = await ok("diagnose", { boss: "uber maven" });
  assert.match(d, /4\. DAMAGE[\s\S]*BOSS CHECK \(uber version/);
  assert.match(d, /- Maven Fireball: takes [\d,]+ \(Fire [\d,]+\) of [\d,]+ raw; pool lasts [\d.]+ hits -> /);
  assert.match(d, /- Maven Memory Game: .*DIES TO ONE HIT/);
  assert.match(d, /Verdict: not ready/);
  assert.match(await ok("diagnose", { boss: "shaper" }), /BOSS CHECK \(pinnacle version[\s\S]*Shaper Slam[\s\S]*Shaper Beam: damage over time/);
  await fails("diagnose", { boss: "nobody" }, /no boss skill preset matching "nobody"\. Presets: Atziri Flameblast/);
  assert.equal(await ok("stats"), before);
  assert.match(await ok("set_config", { search: "presetBossSkills" }), /= (None|unset)/);
});

test("affixes: classify an item's mods", async () => {
  const gloves = await ok("affixes", { slot: "Gloves" });
  assert.match(gloves, /Woe Caress, Fingerless Silk Gloves \(rare, ilvl 78\): prefixes 2\/3 \(1 open\), suffixes 2\/3 \(1 open\)/);
  assert.match(gloves, /Prefix "Rotund" \(T3 of 9, ilvl 36\): \+92 to maximum Life {2}\[rolls \+\(85-99\) to maximum Life\]/);
  assert.match(gloves, /Suffix "of Craft" \(bench craft\): \+15% to Fire and Chaos Resistances/);
  assert.match(gloves, /Not classified: \+2 Life gained for each Enemy hit by your Attacks/);
  assert.match(await ok("affixes", { slot: "Helmet" }), /Unique items have fixed mods/);
  const ring = await ok("affixes", { item_text: "Rarity: RARE\nDoom Knot\nTwo-Stone Ring\nItem Level: 84\nImplicits: 1\n+15% to Fire and Cold Resistances\n+74 to maximum Life\n+41% to Lightning Resistance\n{crafted}+25% to Cold Resistance" });
  assert.match(ring, /prefixes 1\/3 \(2 open\), suffixes 2\/3 \(1 open\)/);
  assert.match(ring, /Suffix ".*" \(T\d of \d, ilvl \d+\): \+41% to Lightning Resistance/);
  await fails("affixes", {}, /Give query/);
  await fails("affixes", { slot: "Nope" }, /unknown slot/);
});

test("suggest_jewels: jewel mods, Watcher's Eye and cluster notables", async () => {
  const j = await ok("suggest_jewels", { limit: 4, focus: "defence" });
  assert.match(j, /Jewel mods for this build \(jewel, defence; \d+ simulated; each mod alone at its best tier and top roll, compared with a blank jewel in Jewel \d+\)/);
  assert.match(j, /1\. .* \[(prefix|suffix); [\w/]+\]: DPS [+-][\d.]+% \| EHP \+[\d.]+%/);
  const c = await ok("suggest_jewels", { kind: "cluster", limit: 3 });
  assert.match(c, /1\. [\w' ]+: .*: DPS [+-][\d.]+% \| EHP [+-][\d.]+%/);
  assert.match(await ok("suggest_jewels", { kind: "abyss", limit: 2, focus: "dps" }), /Murderous|Searching|Hypnotic|Ghastly|No mod of this kind/);
  assert.match(await ok("suggest_jewels", { kind: "watchers_eye", limit: 2 }), /Jewel mods for this build \(watchers_eye/);
});

test("save_build: export code and a note in the build notes", async () => {
  const code = (await ok("save_build", { export_code: true })).split("\n")[1];
  assert.match(code, /^[A-Za-z0-9_-]+=*$/);
  assert.match(await ok("build_summary", { parts: ["notes"] }), /has no notes/);
  await ok("save_build", { name: "occ-vortex - AI notes", note: "Swapped Efficacy for Bonechill" });
  assert.match(await ok("build_summary", { parts: ["notes"] }), /\[AI, \d{4}-\d\d-\d\d\] Swapped Efficacy for Bonechill/);
  assert.match(fs.readFileSync(path.join(builds, "occ-vortex - AI notes.xml"), "utf8"), /Swapped Efficacy for Bonechill/);
  // The code opens as the same build.
  assert.match(await ok("open_build", { code, name: "Round trip" }), /Imported "Round trip"/);
  assert.match(await ok("build_summary", { parts: ["tree"] }), /122 points used/);
  await ok("open_build", { name: "occ-vortex" });
});

test("atlas tools", async () => {
  const get = await ok("atlas_get");
  assert.match(get, /Atlas tree [\d.]+: 0 \/ \d+ points/);
  const found = await ok("atlas_search", { query: "expedition", limit: 3 });
  const id = /^\[([^\]]+)\]/m.exec(found)?.[1];
  assert.ok(id, `no atlas node id in:\n${found}`);
  assert.match(await ok("atlas_edit", { add: [id] }), /Atlas updated: [1-9]\d* \/ \d+ points used/);
  assert.match(await ok("atlas_get"), /Points per mechanic: .*Expedition/i);
  await fails("atlas_edit", {}, /Give add, remove, replace/);
});

test("import a PoB export code as a new build", async () => {
  const zlib = await import("node:zlib");
  const xml = fs.readFileSync(path.join(here, "fixtures", "occ-vortex.xml"));
  const code = zlib.deflateSync(xml).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  assert.match(await ok("open_build", { code, name: "From code" }), /Imported "From code"/);
  assert.match(await ok("status"), /Build: From code\nFile: \(imported, no file\)/);
  await fails("save_build", {}, /no file yet: pass name/);
  assert.match(await ok("build_summary", { parts: ["tree"] }), /122 points used/);
});

test("unknown tools and engine restarts are reported clearly", async () => {
  await fails("lua_get_stats", {}, /Unknown tool "lua_get_stats"/);
});

test("an idle headless engine shuts down and comes back with the build, unsaved edits included", async () => {
  const pob = context.pob;
  await ok("open_build", { name: "occ-vortex" });
  await ok("set_config", { values: { enemyIsBoss: "Pinnacle" } }); // an unsaved edit
  const before = await ok("stats");
  await pob.closeIdle(Date.now() + 1, 0);
  assert.deepEqual(pob.engines(), { headless: false, side: false, parked: true });
  const after = await ok("stats");
  assert.equal(after, before);
  assert.equal(pob.engines().headless, true);
  assert.equal(pob.engines().parked, false);
});

test("cache limits: oldest files go first, only matching files are touched", async () => {
  const { pruneDir, trimLog } = await import("../build/cachePrune.js");
  const dir = fs.mkdtempSync(path.join(tmp, "prune-"));
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, `s${i}.xml`);
    fs.writeFileSync(f, "x".repeat(100));
    fs.utimesSync(f, new Date(now - i * 86_400_000), new Date(now - i * 86_400_000));
  }
  fs.writeFileSync(path.join(dir, "index.json"), "{}");
  assert.deepEqual(pruneDir(dir, { match: /\.xml$/, maxFiles: 4 }, now), { files: 2, bytes: 200 });
  assert.deepEqual(fs.readdirSync(dir).sort(), ["index.json", "s0.xml", "s1.xml", "s2.xml", "s3.xml"]);
  assert.equal(pruneDir(dir, { match: /\.xml$/, maxAgeDays: 1.5 }, now).files, 2);
  assert.equal(pruneDir(dir, { match: /\.xml$/, maxBytes: 150 }, now).files, 1);
  const log = path.join(dir, "answers.log");
  fs.writeFileSync(log, Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n"));
  trimLog(log, 1000);
  const text = fs.readFileSync(log, "utf8");
  assert.ok(text.length <= 1000 && text.endsWith("line 999") && text.startsWith("line "));
});
