// Custom items for theorycraft (3.30 Doedre's Tongue): "All Damage can Ignite / Shock / Freeze
// against Cursed Enemies" did not parse (PoB's whole-line special mods take no trailing
// condition), so a lightning spell got no ignite. Now they parse, PoB's unique data has the 3.30
// version (the old one kept as a "Pre 3.30.0" variant), and what_if / edit name every item line
// PoB did not understand. Made-up build (a Witch with Arc and Conductivity, no gear), headless
// engine, no network. Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-theorycraft-"));
const builds = path.join(tmp, "Builds");
fs.mkdirSync(builds);

const gem = (id, skillId, name, q = 0) => `<Gem enableGlobal2="true" level="20" gemId="Metadata/Items/Gems/${id}" skillId="${skillId}" enableGlobal1="true" qualityId="Default" quality="${q}" enabled="true" nameSpec="${name}"/>`;
const arcBuild = (curse) => `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
\t<Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" viewMode="CALCS">
\t</Build>
\t<Skills>
\t\t<Skill mainActiveSkillCalcs="1" enabled="true" slot="Body Armour" mainActiveSkill="1">
\t\t\t${gem("SkillGemArc", "Arc", "Arc", 20)}
\t\t</Skill>
\t\t<Skill mainActiveSkillCalcs="1" enabled="${curse}" slot="Helmet" mainActiveSkill="1">
\t\t\t${gem("SkillGemConductivity", "Conductivity", "Conductivity")}
\t\t</Skill>
\t</Skills>
\t<Tree activeSpec="1">
\t\t<Spec ascendClassId="0" nodes="" treeVersion="3_26" classId="3"/>
\t</Tree>
\t<Items activeItemSet="1" useSecondWeaponSet="false">
\t\t<ItemSet useSecondWeaponSet="false" id="1"/>
\t</Items>
\t<Config>
\t\t<Input name="enemyIsBoss" string="None"/>
\t</Config>
</PathOfBuilding>
`;
fs.writeFileSync(path.join(builds, "arc-cursed.xml"), arcBuild(true));
fs.writeFileSync(path.join(builds, "arc-no-curse.xml"), arcBuild(false));

process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = builds;
process.env.POB_AGENT_SETTINGS = path.join(tmp, "AgentEdition.json");
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";
fs.writeFileSync(process.env.POB_AGENT_SETTINGS, JSON.stringify({ profile: { playMode: "ssf", league: "Testleague" } }));
globalThis.fetch = async (url) => { throw new Error(`test made an unexpected request: ${url}`); };

const { unparsedText } = await import("../build/tools/edit.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();
after(() => context.pob.close());

async function ok(name, args = {}) {
  const r = await runTool(tools, context, name, args);
  assert.equal(r.isError, false, `${name} failed: ${r.text}`);
  return r.text;
}
// FreezeDurationMod is only set when some of the hit can freeze (PoB's freeze block).
const FIELDS = ["IgniteDPS", "IgniteLightningMax", "IgniteChanceOnHit", "FreezeChance", "FreezeDurationMod", "ShockChanceOnHit"];
async function trial(build, text) {
  await ok("open_build", { name: build });
  const res = await (await context.pob.link()).call("what_if", { ops: [{ op: "equip", slot: "Amulet", text }], fields: FIELDS });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.failed, 0, JSON.stringify(res.results));
  return res;
}
const amulet = (...lines) => ["Rarity: UNIQUE", "Doedre's Tongue", "Lapis Amulet", "Implicits: 1", "+25 to Intelligence",
  "+33% to all Elemental Resistances", "40% chance to Freeze, Shock and Ignite", ...lines].join("\n");

test("a lightning spell ignites with All Damage can Ignite against Cursed Enemies while a curse is on", async () => {
  const res = await trial("arc-cursed", amulet("All Damage can Ignite against Cursed Enemies"));
  assert.ok(!(res.before.IgniteDPS > 0), `no ignite before: ${res.before.IgniteDPS}`);
  assert.ok(res.after.IgniteDPS > 0, `IgniteDPS after: ${res.after.IgniteDPS}`);
  assert.ok(res.after.IgniteLightningMax > 0, "the ignite comes from the lightning damage");
  assert.equal(res.results[0].result.unparsed, undefined, JSON.stringify(res.results[0].result.unparsed));
});

test("the cursed condition counts: no curse, no ignite", async () => {
  const res = await trial("arc-no-curse", amulet("All Damage can Ignite against Cursed Enemies"));
  assert.ok(!(res.after.IgniteDPS > 0), `IgniteDPS without a curse: ${res.after.IgniteDPS}`);
  const plain = await trial("arc-no-curse", amulet("All Damage can Ignite"));
  assert.ok(plain.after.IgniteDPS > 0, "the unconditional line ignites without a curse");
});

test("All Damage can Freeze (against Cursed Enemies) lets lightning hits freeze", async () => {
  for (const line of ["All Damage can Freeze against Cursed Enemies", "All Damage can Freeze"]) {
    const without = await trial("arc-cursed", amulet());
    assert.equal(without.after.FreezeDurationMod, undefined, "lightning alone cannot freeze");
    const res = await trial("arc-cursed", amulet(line));
    assert.ok(res.after.FreezeDurationMod > 0 && res.after.FreezeChance > 0, `${line}: ${JSON.stringify(res.after)}`);
    assert.equal(res.results[0].result.unparsed, undefined, line);
  }
});

test("PoB's unique data has the 3.30 Doedre's Tongue, the old one as a variant", async () => {
  const data = fs.readFileSync(path.join(here, "..", "..", "PathOfBuilding", "src", "Data", "Uniques", "amulet.lua"), "utf8");
  const block = data.match(/\nDoedre's Tongue\r?\n[\s\S]*?(?=\r?\n\]\])/);
  assert.ok(block, "Doedre's Tongue is in amulet.lua");
  const text = block[0].trim();
  for (const v of ["Pre 3.30.0", "Current (Ignite)", "Current (Shock)", "Current (Freeze)"]) assert.ok(text.includes(`Variant: ${v}`), v);
  // Variant 2 = Current (Ignite): the 3.30 rolls and the ignite line, all understood by PoB.
  const res = await trial("arc-cursed", `Rarity: UNIQUE\n${text.replace("LevelReq:", "Selected Variant: 2\nLevelReq:")}`);
  assert.ok(res.after.IgniteDPS > 0, `IgniteDPS with PoB's own 3.30 item: ${res.after.IgniteDPS}`);
  // PoB has never modelled this line (red in its tooltip before 3.30 too); every other line parses.
  assert.deepEqual(res.results[0].result.unparsed, ["Cursed Enemies cannot inflict Elemental Ailments on You"]);
  const old = await trial("arc-cursed", `Rarity: UNIQUE\n${text.replace("LevelReq:", "Selected Variant: 1\nLevelReq:")}`);
  assert.ok(!(old.after.IgniteDPS > 0), "the pre-3.30 version has no ignite line");
});

test("what_if names every item line PoB did not understand", async () => {
  await ok("open_build", { name: "arc-cursed" });
  const text = await ok("what_if", { ops: [{ op: "equip", slot: "Amulet", text: amulet("All Damage can Ignite against Cursed Enemies", "Your Spells summon a made-up Moon Spirit on Hit") }] });
  assert.match(text, /Warning: PoB did not understand this line of Doedre's Tongue/);
  assert.match(text, /  - Your Spells summon a made-up Moon Spirit on Hit/);
  assert.doesNotMatch(text, /  - All Damage can Ignite/);
  assert.doesNotMatch(text, /unparsed=/);
  const clean = await ok("what_if", { ops: [{ op: "equip", slot: "Amulet", text: amulet("All Damage can Shock against Cursed Enemies") }] });
  assert.doesNotMatch(clean, /did not understand/);
  // The formatter alone: two lines, failed ops ignored.
  const L = unparsedText([{ ok: true, result: { name: "Ring", slot: "Ring 1", unparsed: ["a", "b"] } }, { ok: false, error: "x" }]);
  assert.match(L[0], /2 lines of Ring \(Ring 1\)/);
  assert.deepEqual(L.slice(1, 3), ["  - a", "  - b"]);
});
