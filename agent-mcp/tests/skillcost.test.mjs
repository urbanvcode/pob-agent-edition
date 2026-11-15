// Skill cost checks (problem #15): a change that reserves more mana can leave a skill
// (a mark, a guard skill, the main skill) without enough unreserved mana to use. PoB says
// so in its side bar warnings but still counts the skill in DPS. what_if / edit / optimise
// must report it, rank by the real result and offer the cheapest reserving skill to switch
// off; diagnose lists PoB's warnings. Made-up builds only (the Occultist fixture, changed),
// headless engine, no network. Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-skillcost-"));
const builds = path.join(tmp, "Builds");
fs.mkdirSync(builds);
const fixture = fs.readFileSync(path.join(here, "fixtures", "occ-vortex.xml"), "utf8");
fs.writeFileSync(path.join(builds, "cost-test.xml"), fixture);
// The same build with Vitality added: 39 mana left unreserved, Vortex (90) and Frost Bomb (43) can't be cast.
assert.match(fixture, /<\/Skills>/);
fs.writeFileSync(path.join(builds, "cost-blocked.xml"), fixture.replace("</Skills>",
  '\t<Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1"><Gem enableGlobal2="true" level="10" gemId="Metadata/Items/Gems/SkillGemVitality" skillId="Vitality" enableGlobal1="true" qualityId="Default" quality="0" enabled="true" nameSpec="Vitality"/></Skill>\n\t</Skills>'));
// A made-up tree change that takes away mana: the Witch start only, Clarity at level 4. With
// Deep Wisdom (+20 maximum Mana, allocated in the test) 96 mana stays unreserved and Vortex
// (92) fits; respeccing Deep Wisdom away leaves 89, so Vortex can't be cast.
const manaRespec = fixture.replace(/nodes="[^"]*"/, 'nodes="54447"').replace(/(<Gem[^>]*level=")5("[^>]*nameSpec="Clarity")/, "$14$2");
assert.notEqual(manaRespec, fixture);
fs.writeFileSync(path.join(builds, "mana-respec.xml"), manaRespec);
process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = builds;
process.env.POB_AGENT_SETTINGS = path.join(tmp, "AgentEdition.json");
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";
fs.writeFileSync(process.env.POB_AGENT_SETTINGS, JSON.stringify({ profile: { playMode: "ssf", league: "Testleague" } }));
globalThis.fetch = async (url) => { throw new Error(`test made an unexpected request: ${url}`); };

const { costText } = await import("../build/tools/edit.js");
const { gainText } = await import("../build/guideMode.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();
after(() => context.pob.close());

async function ok(name, args = {}) {
  const r = await runTool(tools, context, name, args);
  assert.equal(r.isError, false, `${name} failed: ${r.text}`);
  return r.text;
}

const VITALITY = [{ op: "add_group", gems: [{ name: "Vitality", level: 10 }] }];

test("costText: the warning, the real result and the cheapest fix (the Skitterbots / Sniper's Mark case)", () => {
  const before = { FullDPS: 100000, TotalEHP: 20000 };
  const text = costText({
    manaUnreserved: 30,
    warnings: [{ skill: "Sniper's Mark", cost: 62, pool: 30, resource: "mana", text: "Sniper's Mark costs 62 mana but only 30 is unreserved: it can't be used" }],
    blockedOff: { stats: { FullDPS: 91000, TotalEHP: 20000 }, ops: [{ op: "gem", group: 4, gem: 1, enabled: false }] },
    options: [
      { skill: "Haste", fits: true, freed: 160, stats: { FullDPS: 107800, TotalEHP: 20000 }, ops: [{ op: "gem", group: 5, gem: 1, enabled: false }] },
      { skill: "Herald of Ice", fits: true, freed: 133, stats: { FullDPS: 118500, TotalEHP: 20000 }, ops: [{ op: "gem", group: 6, gem: 1, enabled: false }] },
      { skill: "Summon Skitterbots", fits: true, freed: 200, stats: { FullDPS: 100000, TotalEHP: 20000 }, ops: [{ op: "gem", group: 7, gem: 1, enabled: false }] },
      { skill: "Clarity", fits: false, freed: 20, stats: { FullDPS: 123000, TotalEHP: 20000 }, ops: [] },
    ],
  }, before).join("\n");
  assert.match(text, /^Warning: Sniper's Mark costs 62 mana but only 30 is unreserved: it can't be used\./);
  assert.match(text, /PoB still counts them/);
  assert.match(text, /Real result \(Sniper's Mark switched off\): DPS -9\.0%/);
  // The best option that fits, not the one that leaves the mark short (Clarity).
  assert.match(text, /Cheapest fix: switch off Herald of Ice \(frees 133 mana\) and everything fits: DPS \+18\.5%/);
  assert.match(text, /Clarity off: DPS \+23\.0%, EHP \+0\.0% vs before \(still short\)/);
  assert.match(text, /Haste off: DPS \+7\.8%/);
  assert.deepEqual(costText(undefined, before), []);
  assert.deepEqual(costText({ warnings: [] }, before), []);
});

test("what_if: a change that leaves a skill short says so, with the real result and the cheapest fix", async () => {
  await ok("open_build", { name: "cost-test" });
  const text = await ok("what_if", { ops: VITALITY });
  assert.match(text, /Warning: Vortex costs 90 mana but only 39 is unreserved: it can't be used\./);
  assert.match(text, /Warning: Frost Bomb costs 43 mana/);
  assert.match(text, /Real result \(Frost Bomb, Vortex switched off\): DPS -100\.0%/);
  assert.match(text, /Cheapest fix: switch off \S.* and everything fits: DPS \+0\.0%/);
  assert.match(text, /Rolled back: the build is as it was\./);
  // A change that leaves enough mana: no warning at all.
  const fine = await ok("what_if", { ops: [{ op: "add_group", gems: [{ name: "Precision", level: 5 }] }] });
  assert.doesNotMatch(fine, /Warning:|Cheapest fix/);
});

test("what_if: an aura that over-reserves gives one line, not a line per skill", async () => {
  const text = await ok("what_if", { ops: [{ op: "add_group", gems: [{ name: "Precision", level: 20 }] }] });
  assert.match(text, /Warning: mana is over-reserved after this change \(-\d+ unreserved\), so these skills can't be used: .*Vortex \(90\)/);
  assert.doesNotMatch(text, /Real result/);
  assert.match(text, /Cheapest fix: switch off \S/);
  assert.equal((text.match(/^Warning:/gm) ?? []).length, 1);
});

test("edit: the same warning after a kept change, and lua cost_warnings agrees", async () => {
  const text = await ok("edit", { ops: VITALITY });
  assert.match(text, /Warning: Vortex costs 90 mana but only 39 is unreserved/);
  const link = await context.pob.link();
  const cw = await link.call("cost_warnings");
  assert.deepEqual(cw.warnings.map((w) => w.skill).sort(), ["Frost Bomb", "Vortex"]);
  const vortex = cw.warnings.find((w) => w.skill === "Vortex");
  assert.equal(vortex.cost, 90);
  assert.equal(vortex.pool, 39);
  assert.equal(vortex.group, 5);
  assert.equal(vortex.gem, 6);
  await ok("open_build", { name: "cost-test" }); // put the unchanged build back (nothing was saved)
});

test("diagnose: each skill that can't be used is an error, and PoB's own warning list is shown", async () => {
  await ok("open_build", { name: "cost-blocked" });
  const text = await ok("diagnose");
  assert.match(text, /\[mana\] Vortex costs 90 mana but only 39 is unreserved: it can't be used\. PoB still counts its effect in DPS/);
  assert.match(text, /\[mana\] Frost Bomb costs 43 mana/);
  assert.match(text, /PoB WARNINGS \(\d+, the side bar list\):\n- You do not have enough Mana to use: [^\n]*Vortex/);
  await ok("open_build", { name: "cost-test" });
  assert.doesNotMatch(await ok("diagnose"), /can't be used|enough Mana/);
});

test("optimise: an aura that only fits with another reserving skill off is ranked with that fix in its ops", async () => {
  await ok("open_build", { name: "cost-test" });
  const text = await ok("optimise", { goal: "bossing", levers: ["auras"] });
  const line = text.split("\n").find((l) => /Add Herald of Ice/.test(l));
  assert.ok(line, `Herald of Ice not suggested:\n${text}`);
  assert.match(line, /\+ switch off \S.* \(frees \d+ mana\)/);
  assert.match(line, /NEEDS THE FIX IN THE OPS/);
  const block = text.slice(text.indexOf(line));
  assert.match(block, /side effect: over-reserves mana on its own, so .*Vortex can't be used/);
  assert.match(block, /mana options \(goal score vs the paper gain\): .*\(still short\)/);
  const ops = JSON.parse(block.match(/what_if ops: (\[.*\])/)[1]);
  assert.equal(ops[0].op, "add_group");
  assert.deepEqual({ op: ops[1].op, enabled: ops[1].enabled }, { op: "gem", enabled: false });
  // The ranked ops really fit: simulated together, no skill is left short.
  const check = await ok("what_if", { ops });
  assert.doesNotMatch(check, /Warning:/);
  assert.match(check, /Rolled back/);
});

test("optimise: a respec that takes away mana a skill needs is not ranked on its paper gain", async () => {
  await ok("open_build", { name: "mana-respec" });
  await ok("edit", { ops: [{ op: "alloc", node: 27929 }] }); // Deep Wisdom and its path
  const stats = await ok("stats", { fields: ["ManaUnreserved", "ManaCost"] });
  const free = Number(stats.match(/ManaUnreserved: ([\d,]+)/)?.[1].replace(/,/g, ""));
  const cost = Number(stats.match(/ManaCost: ([\d,]+)/)?.[1].replace(/,/g, ""));
  assert.ok(free >= cost, `the fixture starts with Vortex usable (${free} unreserved, costs ${cost})`);
  // Taking Deep Wisdom out on its own: PoB says Vortex can't be used.
  const alone = await ok("what_if", { ops: [{ op: "dealloc", node: 27929 }] });
  assert.match(alone, /Warning: Vortex costs \d+ mana but only \d+ is unreserved/);

  const text = await ok("optimise", { goal: "bossing", levers: ["respec"], points: 1 }); // 1 point: Deep Wisdom alone
  const lines = text.split("\n");
  const ranked = lines.filter((l) => /^\d+\. \[respec\] Respec Deep Wisdom/.test(l));
  const blocked = lines.find((l) => l.startsWith("Would help but cannot be used now:"));
  assert.ok(ranked.length || (blocked && /Deep Wisdom/.test(blocked)), `the Deep Wisdom respec is considered:\n${text}`);
  // Set aside as breaking Vortex, or ranked only with ops that keep it usable: when the tree
  // change alone blocks Vortex, the line says NEEDS THE FIX and the fix is in its ops.
  if (blocked && /Deep Wisdom/.test(blocked)) assert.match(blocked, /Vortex without enough mana/);
  let fixed = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\d+\. \[respec\] /.test(lines[i])) continue;
    const opsLine = lines.slice(i, i + 6).find((l) => l.trim().startsWith("what_if ops:"));
    assert.ok(opsLine, `ops listed for: ${lines[i]}`);
    const ops = JSON.parse(opsLine.trim().slice("what_if ops:".length));
    const treeOnly = ops.filter((o) => o.op !== "gem");
    const paper = await ok("what_if", { ops: treeOnly });
    if (/Warning: Vortex/.test(paper)) {
      fixed++;
      assert.match(lines[i], /NEEDS THE FIX IN THE OPS/, `ranked on its paper gain: ${lines[i]}`);
      assert.ok(ops.some((o) => o.op === "gem" && o.enabled === false), `the fix is in the ops: ${opsLine}`);
      assert.match(lines.slice(i, i + 4).join("\n"), /Vortex costs \d+ mana but only \d+ is unreserved/);
    }
    // The ranked ops really fit: Vortex stays usable.
    const check = await ok("what_if", { ops });
    assert.doesNotMatch(check, /Warning: Vortex/, `ranked ops still block Vortex: ${opsLine}`);
  }
  assert.ok(fixed > 0 || (blocked && /Deep Wisdom/.test(blocked)), `a Deep Wisdom respec that blocks Vortex is caught:\n${text}`);
  // suggest passives runs the same check on its list (nothing here takes mana away: no regressions).
  const sp = await ok("suggest", { kind: "passives" });
  assert.doesNotMatch(sp, /simulation failed|could not restore/);
  await ok("open_build", { name: "cost-test" });
});

test("guide: a step that leaves a skill without mana says BREAKS A SKILL with its real result", () => {
  const t = gainText({ dps: -900, dpsPct: -100, ehp: 0, ehpPct: 0, life: 0, paperDpsPct: 2.5,
    costWarnings: ["Vortex costs 92 mana but only 89 is unreserved: it can't be used"] });
  assert.match(t, /^DPS -100\.0%/);
  assert.match(t, /BREAKS A SKILL: Vortex costs 92 mana/);
  assert.match(t, /paper DPS \+2\.5%/);
});
