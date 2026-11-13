// Guide mode tests (roadmap Stage 3): unit tests plus the guide tools against a
// fixture build in the headless engine. No network, no PoB window, nothing
// written to the player's Documents. Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-guide-"));
const builds = path.join(tmp, "Builds");
fs.mkdirSync(builds);
fs.copyFileSync(path.join(here, "fixtures", "occ-vortex.xml"), path.join(builds, "occ-vortex.xml"));
process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = builds;
process.env.POB_AGENT_SETTINGS = path.join(tmp, "AgentEdition.json");
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";

const guideMode = await import("../build/guideMode.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();
after(() => context.pob.close());

async function call(name, args = {}) {
  return runTool(tools, context, name, args);
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
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fixture = fs.readFileSync(path.join(here, "fixtures", "occ-vortex.xml"), "utf8");

test("links, stage lines, budgets, item names, trade links", () => {
  assert.equal(guideMode.rawUrl("https://pobb.in/AbCdEf123456"), "https://pobb.in/pob/AbCdEf123456");
  assert.equal(guideMode.rawUrl("https://poe.ninja/poe1/pob/abc12"), "https://poe.ninja/poe1/pob/raw/abc12");
  assert.equal(guideMode.rawUrl("https://pastebin.com/AbCd123"), "https://pastebin.com/raw/AbCd123");
  assert.equal(guideMode.rawUrl("eNrtfQ"), null);
  assert.throws(() => guideMode.rawUrl("https://mobalytics.gg/poe/builds/x"), /Mobalytics pages are built by JavaScript/);
  assert.throws(() => guideMode.rawUrl("https://example.com/x"), /Unknown build site/);
  assert.deepEqual(guideMode.parseSources("Leveling: https://pobb.in/a1\nEndgame = https://pobb.in/b2"),
    [{ stage: "Leveling", ref: "https://pobb.in/a1" }, { stage: "Endgame", ref: "https://pobb.in/b2" }]);
  assert.deepEqual(guideMode.parseSources("https://pobb.in/a1"), [{ ref: "https://pobb.in/a1" }]);
  assert.equal(guideMode.parseBudget("2 div", 150), 300);
  assert.equal(guideMode.parseBudget("150c", 150), 150);
  assert.equal(guideMode.parseBudget("lots", 150), undefined);
  assert.equal(guideMode.itemName("New Item, Spine Bow", "Spine Bow", "RARE"), "rare Spine Bow");
  assert.equal(guideMode.itemName("Headhunter, Leather Belt", "Leather Belt", "UNIQUE"), "Headhunter (unique)");
  assert.equal(guideMode.itemName("Corpse Fletch, Spine Bow", "Spine Bow", "RARE"), "Corpse Fletch, rare Spine Bow");
  const link = decodeURIComponent(guideMode.tradeLink("Standard", { name: "Headhunter" }));
  assert.match(link, /^https:\/\/www\.pathofexile\.com\/trade\/search\/Standard\?q=/);
  assert.match(link, /"status":\{"option":"securable"\}/, "instant buyout only");
});

test("several stage builds merge into one build with loadouts", () => {
  const merged = guideMode.mergeStages([{ stage: "Early", xml: fixture }, { stage: "End", xml: fixture }]);
  assert.deepEqual([...merged.matchAll(/<Spec\b[^>]*\btitle="([^"]*)"/g)].map((m) => m[1]), ["Early", "End"]);
  for (const tag of ["SkillSet", "ItemSet", "ConfigSet"]) {
    assert.deepEqual([...merged.matchAll(new RegExp(`<${tag}\\b[^>]*\\btitle="([^"]*)"`, "g"))].map((m) => m[1]), ["Early", "End"], tag);
  }
  const ids = [...merged.matchAll(/<Item\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(new Set(ids).size, ids.length, "item ids clash");
  assert.equal(ids.length, 2 * [...fixture.matchAll(/<Item\b/g)].length);
  assert.match(guideMode.withSourceNote(merged, ["https://pobb.in/x"]), /<Notes>Guide imported by PoB Agent Edition on \d{4}-\d\d-\d\d from: https:\/\/pobb\.in\/x/);
});

test("stage detection prefers the closest stage the character can reach", () => {
  const stage = (index, nodes, points) => ({ index, title: `S${index}`, points, nodes, items: { Helmet: "A" }, gems: ["X"] });
  const ranked = guideMode.detectStage([stage(1, [1, 2], 2), stage(2, [1, 2, 3, 4, 5], 5), stage(3, [1, 2, 3, 4, 5, 6, 7, 8], 40)], stage(0, [1, 2, 3, 4], 4), 6);
  assert.equal(ranked[0].stage.index, 2);
  assert.equal(ranked.at(-1).stage.index, 3);
});

test("guide tools: import, compare, accept, next steps, card; the build is left alone", async () => {
  const code = zlib.deflateSync(Buffer.from(fixture)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  // The player: the guide's build minus one notable and one support gem.
  await ok("open_build", { name: "occ-vortex" });
  const notable = /Notables \(\d+\): ([^,\n]+)/.exec(await ok("build_summary", { parts: ["tree"] }))[1].trim();
  const nodeId = new RegExp(`^(\\d+) ${escape(notable)} \\[notable`, "m").exec(await ok("tree_search", { query: notable, type: "notable" }))?.[1];
  assert.ok(nodeId, `no id for ${notable}`);
  await ok("edit_tree", { ops: [{ op: "dealloc", nodes: [Number(nodeId)] }] });
  const skills = await ok("build_summary", { parts: ["skills"] });
  const mainSkill = /main skill ([^\n]+)/.exec(skills)[1].trim();
  const main = /^(\d+) \[MAIN[^\]]*\]: (.*)$/m.exec(skills);
  const last = main[2].split(" | ").map((g) => /^(\d+)\.(.+?) \d+\/\d+/.exec(g)).find((m) => m && m[2].trim() !== mainSkill);
  const gem = last[2].trim();
  await ok("edit_skills", { ops: [{ op: "remove_gem", group: Number(main[1]), gem: Number(last[1]) }] });
  await ok("save_build", { name: "occ-player" });

  await fails("guide_compare", {}, /No guide imported yet/);
  await fails("guide_import", { source: "https://mobalytics.gg/poe/builds/x" }, /Mobalytics/);
  const imported = await ok("guide_import", { source: `Early: ${code}\nEnd: ${code}`, name: "Occultist Vortex" });
  assert.match(imported, /Saved the guide as "Guide - Occultist Vortex"/);
  assert.match(imported, /Stages \(2\): 1 Early \(\d+ pts\) \| 2 End/);
  assert.match(imported, /Your open build was not changed/);
  assert.ok(fs.existsSync(path.join(builds, "Guide - Occultist Vortex.xml")));
  assert.match(await ok("guide_import", { source: code, name: "Occultist Vortex" }), /"Guide - Occultist Vortex \(2\)"/, "a second import must not overwrite the first");

  const before = await ok("stats");
  const cmp = await ok("guide_compare", { guide: "Occultist Vortex", stage: "End" });
  assert.match(cmp, /stage 2\/2 "End" \(chosen\)/);
  const [, have, total] = /Matched: passives (\d+)\/(\d+)/.exec(cmp);
  assert.ok(Number(have) < Number(total), "the removed notable should be missing");
  assert.match(cmp, new RegExp(`\\n1\\. .*${escape(notable)}.* \\[notable, \\d+ pts?\\]: DPS [+-][\\d.]+%`));
  assert.match(cmp, new RegExp(`add ${escape(gem)}: DPS [+-][\\d.]+%`));
  assert.match(cmp, /WHAT EXPLAINS THE GAP[\s\S]*- Passive tree: DPS [+-][\d.]+%[\s\S]*- Gems: DPS/);
  assert.match(cmp, /HEADLINE[\s\S]*DPS: you [\d,]+ \| guide [\d,]+/);
  assert.equal(await ok("stats"), before, "guide_compare must leave the build as it was");

  const acc = await ok("guide_compare", { accept: [gem] });
  assert.match(acc, /stage 2\/2 "End" \(remembered\)/);
  assert.doesNotMatch(acc, new RegExp(`add ${escape(gem)}:`));
  assert.match(acc, new RegExp(`Accepted deviations \\(not flagged\\): ${escape(gem)}`));
  assert.match(await ok("guide_compare", { notes: true }), /GUIDE NOTES[\s\S]*Guide imported by PoB Agent Edition/);
  assert.match(await ok("guide_compare", { stage: "auto" }), /\(detected\); closest stage/);
  await fails("guide_compare", { stage: "Nope" }, /No stage "Nope"\. Stages: 1 Early, 2 End/);

  await ok("profile_set", { playMode: "ssf" });
  const next = await ok("guide_next_steps", { limit: 3 });
  assert.match(next, /Mode: ssf/);
  assert.match(next, /1\) PASSIVES[\s\S]*\n1\. .*: DPS [+-][\d.]+%/);
  assert.match(next, /2\) SSF TARGETS/);
  assert.doesNotMatch(next, /pathofexile\.com\/trade/, "no trade links in SSF");
  const card = JSON.parse(fs.readFileSync(path.join(process.env.POB_AGENT_CACHE, "guide", "card.json"), "utf8"));
  assert.ok(["occ-player", "occ-vortex"].includes(card.build), card.build);
  assert.equal(card.stage, "Early", "stage auto went back to detection");
  assert.ok(card.next.length >= 1 && card.match.passives[1] > 0);
  assert.equal(await ok("stats"), before, "guide_next_steps must leave the build as it was");
  await ok("profile_set", { playMode: "trade" });
});
