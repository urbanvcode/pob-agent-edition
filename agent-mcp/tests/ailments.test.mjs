// The build's own ailments in support gem advice (problem #17): PoB counts a shock or chill on
// the enemy only when the config says so, so a support that adds damage looked better than one
// that keeps the shock, and Elemental Focus ("cannot inflict elemental ailments") still got the
// shock the config sets. suggest gems / optimise rank with the build's own shock counted, a
// support that stops it is ranked without and flagged, what_if / edit warn when a change takes an
// ailment away. Made-up build only (the Occultist fixture with a made-up wand and Elemental Hit of
// the Spectrum), headless engine, no network. Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-ailments-"));
const builds = path.join(tmp, "Builds");
fs.mkdirSync(builds);

// An elemental attack with shock chance: the Vortex group becomes Elemental Hit of the Spectrum
// with three supports, the wand a made-up rare with lightning and cold damage, 40% chance to shock
// and no ignite (its fire "can shock but not ignite"). The config sets no ailment on the enemy.
let xml = fs.readFileSync(path.join(here, "fixtures", "occ-vortex.xml"), "utf8");
const wand = /Rarity: RARE\r?\nMaelstrom Cry\r?\nImbued Wand[\s\S]*?(?=\t\t<\/Item>)/;
const group = /<Skill mainActiveSkillCalcs="1" enabled="true" slot="Body Armour" mainActiveSkill="1">[\s\S]*?<\/Skill>/;
const chilled = /\s*<Input name="conditionEnemyChilled" boolean="true"\/>/;
const ignited = /\s*<Input name="conditionEnemyIgnited" boolean="true"\/>/;
const boss = '<Input name="enemyIsBoss" string="Shaper"/>';
for (const re of [wand, group, chilled, ignited]) assert.match(xml, re);
assert.ok(xml.includes(boss));
const gem = (id, skillId, name, q = 20) => `<Gem enableGlobal2="true" level="20" gemId="Metadata/Items/Gems/${id}" skillId="${skillId}" enableGlobal1="true" qualityId="Default" quality="${q}" enabled="true" nameSpec="${name}"/>`;
xml = xml.replace(wand, ["Rarity: RARE", "Storm Needle", "Imbued Wand", "Item Level: 84", "Quality: 20", "Sockets: G-G-G", "LevelReq: 59", "Implicits: 1",
  "33% increased Spell Damage", "Adds 10 to 420 Lightning Damage", "Adds 40 to 80 Cold Damage", "25% increased Attack Speed",
  "+38% to Global Critical Strike Multiplier", "40% chance to Shock", "Your Fire Damage can Shock but not Ignite", ""].join("\n"))
  .replace(group, `<Skill mainActiveSkillCalcs="1" enabled="true" slot="Body Armour" mainActiveSkill="1">
\t\t\t${gem("SkillGemElementalHitAltX", "ElementalHitAltX", "Elemental Hit of the Spectrum")}
\t\t\t${gem("SupportGemElementalDamageWithAttacks", "SupportElementalDamageWithAttacks", "Elemental Damage with Attacks")}
\t\t\t${gem("SupportGemAddedLightningDamage", "SupportAddedLightningDamage", "Added Lightning Damage")}
\t\t\t${gem("SupportGemIncreasedCriticalStrikes", "SupportIncreasedCriticalStrikes", "Increased Critical Strikes", 0)}
\t\t</Skill>`)
  .replace(chilled, "").replace(ignited, "");
// Against a normal monster the hits shock for ~28%; against the pinnacle boss only ~3% (under PoB's 5%).
const normal = xml.replace(boss, '<Input name="enemyIsBoss" string="None"/>');
fs.writeFileSync(path.join(builds, "shock-normal.xml"), normal);
fs.writeFileSync(path.join(builds, "shock-boss.xml"), xml);
// The same with "Is the enemy Shocked?" set by the player.
fs.writeFileSync(path.join(builds, "shock-config.xml"), normal.replace('<Input name="enemyIsBoss"', '<Input name="conditionEnemyShocked" boolean="true"/>\n\t\t<Input name="enemyIsBoss"'));

process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = builds;
process.env.POB_AGENT_SETTINGS = path.join(tmp, "AgentEdition.json");
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";
fs.writeFileSync(process.env.POB_AGENT_SETTINGS, JSON.stringify({ profile: { playMode: "ssf", league: "Testleague" } }));
globalThis.fetch = async (url) => { throw new Error(`test made an unexpected request: ${url}`); };

const { ailmentText } = await import("../build/tools/edit.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();
after(() => context.pob.close());

async function ok(name, args = {}) {
  const r = await runTool(tools, context, name, args);
  assert.equal(r.isError, false, `${name} failed: ${r.text}`);
  return r.text;
}
const FOCUS = [{ op: "add_gem", group: 5, name: "Elemental Focus", quality: 20 }];
const VOLATILITY = [{ op: "add_gem", group: 5, name: "Volatility", quality: 20 }];
const dpsOf = (s) => (s.FullDPS > 0 ? s.FullDPS : s.CombinedDPS);
async function paperGain(ops) {
  const res = await (await context.pob.link()).call("what_if", { ops });
  return (dpsOf(res.after) / dpsOf(res.before) - 1) * 100;
}
async function ranked() {
  const res = await (await context.pob.link()).call("suggest_gems", { add: true, only: ["Elemental Focus", "Volatility"] }, 180_000);
  assert.equal(res.ok, true, JSON.stringify(res));
  const by = Object.fromEntries(res.candidates.map((c) => [c.name, c]));
  assert.ok(by["Elemental Focus"] && by.Volatility, JSON.stringify(res.candidates));
  return { res, focus: by["Elemental Focus"], volatility: by.Volatility };
}

test("ailmentText: the lost ailments, and the config that still counts them", () => {
  const text = ailmentText({ skill: "Elemental Hit", lost: [{ name: "Shock" }, { name: "Chill" }], text: "you lose your shock (~28% more damage taken) and chill (~30% slower enemy)", configStillOn: ["Shock"] }).join("\n");
  assert.match(text, /^Warning: Elemental Hit can no longer inflict shock, chill: you lose your shock \(~28% more damage taken\) and chill/);
  assert.match(text, /"Is the enemy Shocked\?"\), so PoB keeps counting it: the DPS after is too high/);
  assert.deepEqual(ailmentText(undefined), []);
  assert.deepEqual(ailmentText({ lost: [] }), []);
});

test("suggest gems: the build's own shock is counted, and the Elemental Focus vs Volatility ranking flips", async () => {
  await ok("open_build", { name: "shock-normal" });
  // On paper (the config sets no shock) Elemental Focus beats Volatility.
  const paperFocus = await paperGain(FOCUS), paperVolatility = await paperGain(VOLATILITY);
  assert.ok(paperFocus > paperVolatility, `paper: Elemental Focus ${paperFocus} vs Volatility ${paperVolatility}`);
  const { res, focus, volatility } = await ranked();
  const shock = res.ownAilments?.list?.find((a) => a.name === "Shock");
  assert.ok(shock && shock.effect >= 5 && res.ownAilments.dpsPct > 5, JSON.stringify(res.ownAilments));
  // With the shock counted, Volatility (keeps it) beats Elemental Focus (loses it), and the loss is said.
  assert.ok(volatility.dpsPct > focus.dpsPct, `ranked: Volatility ${volatility.dpsPct} vs Elemental Focus ${focus.dpsPct}`);
  assert.ok(focus.dpsPct < paperFocus, "Elemental Focus is ranked without the shock it takes away");
  assert.deepEqual(focus.lostAilments.slice(0, 2), ["Shock", "Chill"]);
  assert.match(focus.warning, /can no longer inflict ailments: you lose your shock \(~\d+% more damage taken\), chill \(~\d+% slower enemy\)/);
  assert.equal(volatility.lostAilments, undefined);
  // The tool text names the assumption.
  const text = await ok("suggest", { kind: "gems", add: true });
  assert.match(text, /Counts your own shock \(~\d+% more damage taken\), chill \(~\d+% slower\): the skill inflicts them, but PoB only counts them when Configuration says/);
});

test("what_if: adding Elemental Focus warns that the shock is lost", async () => {
  await ok("open_build", { name: "shock-normal" });
  const text = await ok("what_if", { ops: FOCUS });
  assert.match(text, /Warning: Elemental Hit of the Spectrum can no longer inflict shock, chill, freeze: you lose your shock \(~\d+% more damage taken\)/);
  assert.doesNotMatch(text, /config still says/);
  const fine = await ok("what_if", { ops: VOLATILITY });
  assert.doesNotMatch(fine, /can no longer inflict/);
});

test("config sets the enemy Shocked: Elemental Focus is still ranked without the shock, and what_if says the config keeps counting it", async () => {
  await ok("open_build", { name: "shock-config" });
  const paperFocus = await paperGain(FOCUS);
  const { res, focus } = await ranked();
  assert.ok(!res.ownAilments?.list?.some((a) => a.name === "Shock"), "the player's own shock setting is left alone");
  assert.ok(focus.dpsPct < paperFocus - 1, `Elemental Focus ${focus.dpsPct} must lose the configured shock (paper ${paperFocus})`);
  assert.ok(focus.lostAilments.includes("Shock"));
  const text = await ok("what_if", { ops: FOCUS });
  assert.match(text, /The config still says the enemy has it \("Is the enemy Shocked\?"\), so PoB keeps counting it/);
});

test("pinnacle boss: a shock under PoB's 5% minimum is not counted, and the result says so", async () => {
  await ok("open_build", { name: "shock-boss" });
  const { res } = await ranked();
  assert.ok(!res.ownAilments?.list?.some((a) => a.name === "Shock"), JSON.stringify(res.ownAilments));
  assert.ok(res.ownWeak?.some((a) => a.name === "Shock" && a.effect < 5), JSON.stringify(res.ownWeak));
  const text = await ok("suggest", { kind: "gems", add: true });
  assert.match(text, /Not counted: your shock is ~[\d.]+% on this enemy, under PoB's 5% minimum/);
});
