// Optimiser tests (roadmap Stage 4): unit tests for the formatting, mechanic tags
// and explanations, plus the optimise tool against a fixture build in the headless
// engine. No network, no PoB window, nothing written to the player's Documents.
// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-optimise-"));
const builds = path.join(tmp, "Builds");
fs.mkdirSync(builds);
fs.copyFileSync(path.join(here, "fixtures", "occ-vortex.xml"), path.join(builds, "occ-vortex.xml"));
// The same build with Trinity in place of Hypothermia (its resonance count is 0, as after an import)
// and Dexterity cut to just above what the gems need, so stronger Dex supports leave it short.
const vortexXml = fs.readFileSync(path.join(here, "fixtures", "occ-vortex.xml"), "utf8");
const hypothermia = /<Gem [^>]*nameSpec="Hypothermia"\/>/;
assert.match(vortexXml, hypothermia);
fs.writeFileSync(path.join(builds, "trinity-test.xml"), vortexXml.replace(hypothermia,
  '<Gem enableGlobal2="true" level="20" gemId="Metadata/Items/Gems/SkillGemSupportTrinity" skillId="SupportTrinity" enableGlobal1="true" qualityId="Default" quality="0" enabled="true" nameSpec="Trinity"/>').replace("+11 to Dexterity", "-12 to Dexterity"));
process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = builds;
process.env.POB_AGENT_SETTINGS = path.join(tmp, "AgentEdition.json");
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";

const opt = await import("../build/tools/optimise.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();
after(() => context.pob.close());

async function ok(name, args = {}) {
  const r = await runTool(tools, context, name, args);
  assert.equal(r.isError, false, `${name} failed: ${r.text}`);
  return r.text;
}

const zero = { stPct: 0, dpsPct: 0, ehpPct: 0, hitPct: 0, msPct: 0, areaPct: 0, life: 0, res: {} };

test("mechanic tags: the lever first, then what the stat text names, 'more and increased' last", () => {
  assert.deepEqual(opt.mechanicTags({ lever: "passive", text: "Divine Judgement", stats: ["50% increased Elemental Damage"] }), ["More and increased"]);
  assert.deepEqual(opt.mechanicTags({ lever: "passive", kind: "Keystone", text: "Mind Over Matter", stats: ["30% of Damage is taken from Mana before Life"] }), ["Keystone"]);
  assert.deepEqual(opt.mechanicTags({ lever: "anoint", mechanic: "Anoint", text: "Anoint X", stats: ["Damage Penetrates 10% Cold Resistance", "+20% to Critical Strike Multiplier"] }),
    ["Anoint", "Critical strike", "Penetration"]);
  assert.equal(opt.mechanicTags({ lever: "gem", mechanic: "Support gem", text: "Swap A for B" })[0], "Support gem");
});

test("explanations follow the profile's explanation mode", () => {
  const tags = ["Support gem", "More and increased", "Critical strike"];
  assert.deepEqual(opt.explanations(tags, "concise", []), []);
  const teach = opt.explanations(tags, "teach", ["support gem"]);
  assert.equal(teach.length, 2, "a learned topic is not explained again");
  assert.ok(teach.every((l) => /poewiki\.net\/wiki\//.test(l) && /3\.\d+/.test(l)), "every explanation is cited with version and link");
  assert.match(teach.join("\n"), /More and increased[\s\S]*PoE2|Critical strike/);
  assert.equal(opt.explanations(tags, "deep", ["support gem"]).length, 3, "deep mode explains everything, learned or not");
});

test("cost labels and before -> after numbers", () => {
  assert.equal(opt.shortCost({ lever: "respec", cost: { regret: 2 } }), "2 regret");
  assert.equal(opt.shortCost({ lever: "passive", cost: { points: 1 } }), "1 pt");
  assert.equal(opt.shortCost({ lever: "gem", cost: { buy: "Awakened Empower", awakened: true } }), "buy (awakened)");
  assert.equal(opt.shortCost({ lever: "pantheon", cost: { note: "x" } }), "switch");
  assert.equal(opt.afterText({ ...zero, stPct: 10 }, "bossing", { singleTargetDps: 1000 }), " (single-target DPS 1,000 -> 1,100)");
  assert.equal(opt.afterText({ ...zero, ehpPct: 50 }, "tankiness", { ehp: 2000 }), " (EHP 2,000 -> 3,000)");
  assert.equal(opt.afterText(zero, "clear", { dps: 1000 }), "");
});

test("formatOptimise: ranked list, under-counting, scaling report, explanations", () => {
  const r = {
    goal: "bossing", goalLabel: "single target / bossing", metric: "single-target DPS", tempConfig: { enemyIsBoss: "Pinnacle" },
    assumptions: "enemy: pinnacle boss", mainSkill: "Vortex", seconds: 1, evaluated: { total: 3 }, maxPoints: 6, pointsFree: 2, more: 1,
    base: { singleTargetDps: 1000, dps: 1000, ehp: 5000, weakestHit: 3000, life: 4000 },
    suggestions: [
      { lever: "passive", text: "Divine Judgement", stats: ["50% increased Elemental Damage"], gain: { ...zero, stPct: 10, dpsPct: 10 }, cost: { points: 6 }, ops: [{ op: "alloc", node: 1 }] },
      { lever: "respec", text: "Respec A (1 points) into B (1 points)", gain: { ...zero, stPct: 2, dpsPct: 2, ehpPct: -4 }, cost: { regret: 1 }, sideEffects: ["costs 4.0% EHP / 0.0% weakest max hit"], ops: [] },
    ],
    undercount: [{ text: "Is the enemy Shocked?", key: "conditionEnemyShocked", gain: { ...zero, stPct: 15 }, ops: [{ op: "config", values: { conditionEnemyShocked: true } }] }],
    blocked: [{ name: "Malevolence", gain: { ...zero, stPct: 15 }, why: "not enough unreserved mana or life to reserve it" }],
    scaling: [{ stat: "10% more Damage", gain: { ...zero, stPct: 10 }, score: 10 }],
  };
  const { text } = opt.formatOptimise(r, "teach", []);
  assert.match(text, /enemyIsBoss = Pinnacle \(temporary, restored afterwards\)/);
  assert.match(text, /1\. \[passive\] Divine Judgement - 6 points: single-target DPS \+10\.0%.*\(single-target DPS 1,000 -> 1,100\)/);
  assert.match(text, /what_if ops: \[\{"op":"alloc","node":1\}\]/);
  assert.match(text, /2\. \[respec\].*1 Orb of Regret[\s\S]*side effect: costs 4\.0% EHP/);
  assert.match(text, /\(1 more; raise limit\)/);
  assert.match(text, /under-counting[\s\S]*Is the enemy Shocked\? \[conditionEnemyShocked\]/);
  assert.match(text, /Malevolence.*not enough unreserved mana/);
  assert.match(text, /Scaling report[\s\S]*10% more Damage/);
  assert.match(text, /Mechanics \(teach mode[\s\S]*More and increased:/);
  assert.doesNotMatch(opt.formatOptimise(r, "concise", []).text, /Mechanics \(/);
});

test("formatOptimise: attribute-short changes are marked and listed after usable ones' warnings", () => {
  const r = {
    goal: "bossing", goalLabel: "single target / bossing", metric: "x", tempConfig: { enemyIsBoss: "Pinnacle", configResonanceCount: 50 }, assumptions: "a", base: {},
    suggestions: [
      { lever: "gem", text: "Swap Trinity for Some Support in Skill", gain: { ...zero, stPct: 30 }, cost: { buy: "Some Support" }, unusable: true,
        sideEffects: ["needs 120 Int, you have 74 (46 short): get it from gear or passives first, the gain only counts once it is met"], ops: [] },
    ],
    undercount: [{ text: "Trinity: Lowest Resonance Count is 0 in PoB (x); this run assumed 50", key: "configResonanceCount", gain: { ...zero, stPct: 55 } }],
    unsetCounts: [{ skill: "Some Skill", label: "# of Stages", var: "someStages" }],
  };
  const { text } = opt.formatOptimise(r, "concise", []);
  assert.match(text, /configResonanceCount = 50 \(temporary, restored afterwards\)/);
  assert.match(text, /Swap Trinity .* NOT USABLE YET \(attributes short\)/);
  assert.match(text, /side effect: needs 120 Int, you have 74 \(46 short\)/);
  assert.match(text, /Trinity: Lowest Resonance Count is 0 in PoB.*\[configResonanceCount\]: single-target DPS \+55/);
  assert.match(text, /Also 0 in PoB.*Some Skill: # of Stages \[someStages\]/);
});

test("Trinity: resonance 0 in PoB is under-counted, gem swaps are measured with it set, config put back", async () => {
  await ok("open_build", { name: "trinity-test" });
  const before = await ok("stats", { fields: ["CombinedDPS", "TotalEHP", "Life"] });
  const gems = await ok("suggest_gems", {});
  assert.match(gems, /Measured with Trinity: Lowest Resonance Count = 50 \(0 in PoB, Trinity gives no damage at 0 resonance/);
  const trinity = gems.match(/- gem \d+ Trinity [\d/]+: -([\d.]+)%/);
  assert.ok(trinity && Number(trinity[1]) > 1, `Trinity is worth something once resonance is counted:\n${gems}`);

  const all = await ok("suggest_gems", { limit: 25 });
  assert.match(all, /\d+\. .*Warning: needs \d+ Dex, you have 112 \(the gem does nothing until that is met\)/, "a support the character lacks Dexterity for says so");

  const boss = await ok("optimise", { goal: "bossing", levers: ["gems", "config"] });
  assert.match(boss, /Config for this run: [^\n]*configResonanceCount = 50/);
  assert.match(boss, /under-counting[\s\S]*- Trinity: Lowest Resonance Count is 0 in PoB .*this run assumed 50.*\[configResonanceCount\]: single-target DPS \+/);
  for (const m of boss.matchAll(/\[gem\] Swap Trinity for .*: single-target DPS ([+-][\d.]+)%/g)) {
    // A swap measured with resonance 50 is not a free gain from removing a gem that did nothing.
    assert.ok(Number(m[1]) < 40, `swap gain looks like it was measured at resonance 0: ${m[0]}`);
  }
  assert.equal(await ok("stats", { fields: ["CombinedDPS", "TotalEHP", "Life"] }), before, "the build and its config are exactly as before");
  await ok("open_build", { name: "occ-vortex" });
});

test("optimise tool: every goal simulated in PoB, build and config put back", async () => {
  await ok("list_builds");
  await ok("open_build", { name: "occ-vortex" });
  await ok("profile", { explanationMode: "teach" });
  const before = await ok("stats", { fields: ["CombinedDPS", "TotalEHP", "Life", "EnergyShield"] });
  const config = await ok("stats", { match: "enemy" });

  const boss = await ok("optimise", { goal: "bossing" });
  assert.match(boss, /^Optimiser: single target \/ bossing; main skill Vortex; \d+ options simulated/);
  assert.match(boss, /Ranked by gain per cost/);
  assert.match(boss, /\n1\. \[(passive|gem|mastery|respec|anoint|aura|curse|herald|flask|pantheon|bandit|gem level|gem quality)\] /);
  assert.match(boss, /\[passive\] .* - \d+ points?: single-target DPS \+/);
  assert.match(boss, /\[gem\] Swap .* for .* in Vortex/);
  assert.match(boss, /mechanic: /);
  assert.match(boss, /what_if ops: \[/);
  assert.match(boss, /Scaling report/);
  assert.match(boss, /Mechanics \(teach mode/);
  assert.match(boss, /Gear: plan_upgrades \{ budget_chaos, focus: "dps" \}/);

  const clear = await ok("optimise", { goal: "clear", levers: ["passives", "config"], limit: 5 });
  assert.match(clear, /Config for this run: enemyIsBoss = None \(temporary, restored afterwards\); enemy: no boss/);
  assert.ok((clear.match(/\n\d+\. \[/g) ?? []).length <= 5, "limit is respected");
  assert.doesNotMatch(clear, /\[gem\]/, "levers limit what is searched");

  const tank = await ok("optimise", { goal: "tankiness", levers: ["passives", "anoint", "pantheon"] });
  assert.match(tank, /Metric: 0\.5 x EHP/);
  assert.match(tank, /\(EHP [\d,]+ -> [\d,]+\)/);
  assert.match(tank, /Gear: plan_upgrades \{ budget_chaos, focus: "defence" \}/);

  const weak = await ok("optimise", { levers: ["passives"] });
  assert.match(weak, /^Optimiser: (tankiness|balanced|single target \/ bossing) \(fix weakest: /);

  await ok("profile", { playMode: "ssf", hardcore: true });
  const hc = await ok("optimise", { goal: "bossing", levers: ["passives", "respec"] });
  assert.doesNotMatch(hc, /side effect: costs [\d.]+% EHP/, "hardcore never trades defence away for damage");
  assert.match(hc, /Gear \(SSF\)/);
  await ok("profile", { playMode: "trade", hardcore: false });

  assert.equal(await ok("stats", { fields: ["CombinedDPS", "TotalEHP", "Life", "EnergyShield"] }), before, "the build is exactly as before");
  assert.equal(await ok("stats", { match: "enemy" }), config, "the temporary goal config is restored");
});
