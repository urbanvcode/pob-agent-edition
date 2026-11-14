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

test("gem levels are never a ranked action: a note, or (trade/mixed) a priced 20/20 copy", async () => {
  const levels = [
    { name: "Sample Strike", from: 17, to: 20, dpsPct: 4, quality: 0, maxLevel: 20, canUseMax: true },
    { name: "Sample Mark", from: 16, to: 20, dpsPct: 1, quality: 0, maxLevel: 20, canUseMax: true },
    { name: "Sample Herald", from: 11, to: 16, dpsPct: 2, quality: 0, maxLevel: 20, canUseMax: false },
  ];
  const lines = [
    { name: "Sample Strike", chaosValue: 40, gemLevel: 20, gemQuality: 20, listingCount: 50 },
    { name: "Sample Strike", chaosValue: 400, gemLevel: 21, gemQuality: 20, corrupted: true, listingCount: 50 },
    { name: "Sample Mark", chaosValue: 3, gemLevel: 20, gemQuality: 20, listingCount: 50 },
    { name: "Sample Herald", chaosValue: 1, gemLevel: 20, gemQuality: 20, listingCount: 50 },
  ];
  const prices = await opt.priceGemCopies(levels, "Test", lines);
  assert.equal(prices.get("Sample Strike").chaos, 40, "uncorrupted 20/20 price");
  assert.equal(prices.has("Sample Herald"), false, "not priced when the character cannot use level 20 yet");
  const trade = opt.gemLevelLines(levels, "trade", prices).join("\n");
  assert.match(trade, /buy a levelled copy[\s\S]*- Sample Mark 20\/20: 3c[\s\S]*- Sample Strike 20\/20: 40c/, "cheapest first");
  assert.match(trade, /Will come with levelling \(gems gain levels from experience; nothing to do\): Sample Herald 11 -> 16/);
  assert.doesNotMatch(trade, /Sample Strike 17 -> 20/);
  assert.match(opt.gemLevelLines(levels, "mixed", prices).join("\n"), /\[Trade\] Optional: buy/);
  const ssf = opt.gemLevelLines(levels, "ssf", prices).join("\n");
  assert.doesNotMatch(ssf, /buy|\dc\b/);
  assert.match(ssf, /Will come with levelling[^\n]*Sample Strike 17 -> 20[^\n]*Sample Mark[^\n]*Sample Herald/);
  assert.deepEqual(opt.gemLevelLines([], "trade"), []);
});

test("optimise tool: every goal simulated in PoB, build and config put back", async () => {
  opt.gemPriceSource.lines = async () => []; // no poe.ninja in tests
  await ok("list_builds");
  await ok("open_build", { name: "occ-vortex" });
  await ok("profile", { explanationMode: "teach", league: "Standard" });
  const before = await ok("stats", { fields: ["CombinedDPS", "TotalEHP", "Life", "EnergyShield"] });
  const config = await ok("stats", { match: "enemy" });

  const boss = await ok("optimise", { goal: "bossing" });
  assert.match(boss, /^Optimiser: single target \/ bossing; main skill Vortex; \d+ options simulated/);
  assert.match(boss, /Ranked by gain per cost/);
  assert.match(boss, /\n1\. \[(passive|gem|mastery|respec|anoint|aura|curse|herald|flask|pantheon|bandit|gem quality)\] /);
  assert.match(boss, /\[passive\] .* - \d+ points?: single-target DPS \+/);
  assert.match(boss, /\[gem\] Swap .* for .* in Vortex/);
  assert.match(boss, /mechanic: /);
  assert.match(boss, /what_if ops: \[/);
  assert.match(boss, /Scaling report/);
  assert.doesNotMatch(boss, /\[gem level\]|level the gem/, "gem levels are not an action");
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
