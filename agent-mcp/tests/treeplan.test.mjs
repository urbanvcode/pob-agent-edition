// Tree compare / respec planner: compare { tree }, set_view { compare }, edit spec_notes.
// Headless engine on the occ-vortex fixture; every name below is made up.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-treeplan-"));
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

async function ok(name, args = {}) {
  const r = await runTool(tools, context, name, args);
  assert.equal(r.isError, false, `${name} failed: ${r.text}`);
  return r.text;
}
async function fails(name, args, pattern) {
  const r = await runTool(tools, context, name, args);
  assert.equal(r.isError, true, `${name} should have failed: ${r.text}`);
  assert.match(r.text, pattern);
}
const row = (text, id) => text.split("\n").find((l) => l.includes(`] ${id} `)) ?? assert.fail(`no row ${id} in:\n${text}`);

// Nodes of the fixture (Witch tree): Elemental Overload (keystone, allocated), Ash, Frost and
// Storm and Mystic Bulwark (notables, free); strength and resistance notables (allocated).
const EO = 22088, AFS = 45317, MB = 18174;
const orderOf = (text, id) => Number(/^ (\d+)\./.exec(row(text, id))[1]);
const RISKY = [25058, 36949, 54694, 49254, 33435, 21958];

test("compare { tree }: one row per change with its own gain, cost summary, notes", async () => {
  await ok("open_build", { name: "occ-vortex" });
  await ok("edit", { ops: [{ op: "spec", create: "AI plan" }, { op: "dealloc", nodes: [EO] }, { op: "alloc", nodes: [AFS, MB] },
    { op: "spec_notes", notes: { [AFS]: "more elemental damage", [EO]: "crits are rare here" } }, { op: "spec", index: 1 }] });
  const text = await ok("compare", { tree: "AI plan" });
  assert.match(text, /TREE PLAN: .* \(active tree\) -> AI plan/);
  assert.match(text, /RESPEC: 1 Orb of Regret .*points 122 -> 126 of 122/);
  assert.match(text, /Uses 4 more points than the character has/);
  assert.match(text, /CHOSEN \(3 of 3 changes, together\): DPS [-+][\d.]+%/);
  assert.match(row(text, `+${AFS}`), /\[x\] \+45317 NEW Ash, Frost and Storm \(notable, 3 points\): DPS \+6\.\d% .*note: more elemental damage/);
  assert.match(row(text, `-${EO}`), /REMOVED Elemental Overload \(keystone, frees 1\): DPS -2\d\.\d%.*note: crits are rare here/);
  assert.match(row(text, `+${MB}`), /EHP \+4\.\d%/);
  // By number too.
  assert.match(await ok("compare", { tree: 2 }), /-> AI plan/);
});

test("compare { tree, skip }: the ticked subset is recalculated", async () => {
  const all = await ok("compare", { tree: 2 });
  const sub = await ok("compare", { tree: 2, skip: [`-${EO}`] });
  assert.match(sub, /RESPEC: 0 Orbs of Regret/);
  assert.match(sub, /CHOSEN \(2 of 3 changes, together\): DPS \+\d/);
  assert.match(row(sub, `-${EO}`), /^ \d+\. \[ \] /);
  const dps = (t) => Number(/CHOSEN[^\n]*DPS ([-+][\d.]+)%/.exec(t)[1]);
  assert.ok(dps(sub) > dps(all), "keeping Elemental Overload must give more DPS than the full plan");
  assert.match(await ok("compare", { tree: 2, skip: ["+999999"] }), /Unknown change ids in skip \(ignored\): \+999999/);
});

test("compare { tree }: warnings for attributes and resistance caps, cut-off nodes", async () => {
  await ok("edit", { ops: [{ op: "spec", create: "Risky" }, { op: "dealloc", nodes: RISKY }, { op: "spec", index: 1 }] });
  const text = await ok("compare", { tree: "Risky" });
  assert.match(text, /WARNINGS \(same checks as what_if\):/);
  assert.match(text, /Needs 155 Str but has \d+ \(\d+ short\)/);
  assert.match(text, /Fire resistance falls under the cap: 75% -> \d+% \(\d+% short\)/);
  assert.match(row(text, "-49254"), /also cuts off: .*Holy Dominion.*small passives/);
  // Without the removals that lose the strength, the attribute warning goes away.
  const kept = await ok("compare", { tree: "Risky", skip: ["-21958", "-25058", "-49254", "-41472", "-33435", "-54694", "-36949"] });
  assert.ok(!/Str but has/.test(kept), kept);
});

test("compare { tree, save_as } keeps the subset as a new tree; notes are saved and reloaded", async () => {
  const saved = await ok("compare", { tree: "AI plan", skip: [`-${EO}`], save_as: "AI subset" });
  assert.match(saved, /Saved the ticked set as tree 4 "AI subset" \(not active; the player's tree is unchanged/);
  const back = await ok("compare", { tree: "AI subset" });
  assert.match(back, /NEW Ash, Frost and Storm/);
  assert.ok(!/REMOVED Elemental Overload/.test(back), "the unticked removal must not be in the saved tree");
  assert.match(row(back, `+${AFS}`), /note: more elemental damage/);
  // The player's tree is untouched.
  assert.match(await ok("tree_search", { query: "elemental overload", type: "keystone" }), /allocated/);
  // Notes survive a save and a reload of the build file.
  await ok("save_build", { name: "occ-vortex - AI notes" });
  assert.match(fs.readFileSync(path.join(builds, "occ-vortex - AI notes.xml"), "utf8"), /<AgentNotes>[\s\S]*nodeId="45317"[\s\S]*more elemental damage/);
  await ok("open_build", { name: "occ-vortex - AI notes" });
  assert.match(row(await ok("compare", { tree: "AI plan" }), `-${EO}`), /note: crits are rare here/);
  // spec_notes errors and clearing
  assert.match(await ok("edit", { ops: [{ op: "spec_notes", spec: "AI plan", notes: { [AFS]: "" } }] }), /cleared=1/);
  assert.match(await ok("edit", { ops: [{ op: "spec_notes", spec: 9, notes: { 1: "x" } }] }), /FAILED spec_notes: no tree 9/);
});

test("compare { tree }: another build, the last sync, the active tree", async () => {
  // Another build: the AI tree saved as its own file (made-up name).
  await ok("edit", { ops: [{ op: "spec", index: 2 }] });
  await ok("save_build", { name: "Test - other tree" });
  await ok("open_build", { name: "occ-vortex - AI notes" });
  const other = await ok("compare", { tree: "Test - other tree" });
  assert.match(other, /-> Test - other tree \(another build\)/);
  assert.match(other, /NEW Ash, Frost and Storm/);

  // Last sync: a made-up character history whose build is the open one.
  const hist = path.join(tmp, "cache", "history");
  const dir = path.join(hist, "pc_testaccount_testchar");
  fs.mkdirSync(dir, { recursive: true });
  const older = fs.readFileSync(path.join(builds, "Test - other tree.xml"), "utf8");
  const newer = fs.readFileSync(path.join(builds, "occ-vortex - AI notes.xml"), "utf8");
  fs.writeFileSync(path.join(dir, "2026-01-01T10-00-00-000Z.xml"), older);
  fs.writeFileSync(path.join(dir, "2026-01-02T10-00-00-000Z.xml"), newer);
  fs.writeFileSync(path.join(hist, "pc_testaccount_testchar.json"), JSON.stringify({
    version: 1, account: "testaccount#0000", realm: "pc", character: "testchar", characterHash: "0000test", build: "occ-vortex - AI notes",
    entries: [{ at: "2026-01-01T10:00:00.000Z", snapshot: "2026-01-01T10-00-00-000Z.xml" }, { at: "2026-01-02T10:00:00.000Z", snapshot: "2026-01-02T10-00-00-000Z.xml" }],
  }));
  const last = await ok("compare", { tree: "last sync" });
  assert.match(last, /-> Last sync 2026-01-01 10:00 \(another build\)/); // the newest is the build itself: the one before
  assert.match(last, /NEW Ash, Frost and Storm/);

  await fails("compare", { tree: 1 }, /that is the active tree/);
  await fails("compare", { tree: "no such tree" }, /no tree "no such tree" in this build \(trees: 1 = /);
});

test("set_view { compare } needs the PoB window; what_if keep names the tree view", async () => {
  assert.match(await ok("set_view", { view: "TREE", compare: 2 }), /only works in the PoB window/);
  assert.match(await ok("set_view", { view: "TREE", compare: false }), /only works in the PoB window/);
  const kept = await ok("what_if", { ops: [{ op: "alloc", nodes: [MB] }], keep: true });
  assert.match(kept, /set_view \{ view: "TREE", compare: "AI" \}/);
});

test("order to take the changes: numbered, a removal further out first", async () => {
  await ok("open_build", { name: "occ-vortex" });
  await ok("edit", { ops: [{ op: "spec", create: "Risky" }, { op: "dealloc", nodes: RISKY }, { op: "spec", index: 1 }] });
  const text = await ok("compare", { tree: "Risky" });
  assert.match(text, /CHANGES in the order to take them/);
  // Cruel Preparation leads to Heart of Ice: Heart of Ice is refunded first.
  assert.ok(orderOf(text, "-8833") < orderOf(text, "-21958"), text);
  assert.match(row(text, "-21958"), /after .*-8833/);
});

test("apply_tree writes a new tree only; jewel differences are listed", async () => {
  await ok("edit", { ops: [{ op: "spec", create: "Jewelless" }, { op: "unequip", slot: "Jewel 36634" }, { op: "spec", index: 1 }] });
  const jewel = await ok("compare", { tree: "Jewelless" });
  assert.match(row(jewel, "j36634"), /JEWEL CHANGED .*Cataclysm Stone.* -> empty/);
  const before = await ok("tree_search", { query: "elemental overload", type: "keystone" });
  const applied = await ok("edit", { ops: [{ op: "apply_tree", tree: "Risky", only: ["-8833"], title: "Test applied" }] });
  assert.match(applied, /ok apply_tree: applied=-8833; .*title=Test applied; tree=\d+/);
  assert.equal(await ok("tree_search", { query: "elemental overload", type: "keystone" }), before);
  const appliedPlan = await ok("compare", { tree: "Test applied" }); // only that removal (and what it cuts off) is in the new tree
  assert.match(appliedPlan, /REMOVED Heart of Ice/);
  assert.ok(!/Cruel Preparation|Blood Siphon/.test(appliedPlan), appliedPlan);
  // what_if rolls the new tree back.
  await ok("what_if", { ops: [{ op: "apply_tree", tree: "Risky" }] });
  await fails("compare", { tree: "Spec 1 - applied" }, /no tree/);
});

test("compare any two trees: a guide stage, a pasted code, two builds neither of which is open", async () => {
  const zlib = await import("node:zlib");
  const xml = fs.readFileSync(path.join(builds, "occ-vortex.xml"), "utf8");
  const code = zlib.deflateSync(Buffer.from(xml)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  // A guide with two stages: the fixture, and the fixture without Elemental Overload (saved as a build first).
  await ok("open_build", { name: "occ-vortex" });
  await ok("edit", { ops: [{ op: "dealloc", nodes: [EO] }] });
  await ok("save_build", { name: "Test - no EO" });
  const { mergeStages } = await import("../build/guideMode.js");
  fs.writeFileSync(path.join(builds, "Guide - Test.xml"), mergeStages([{ stage: "Start", xml }, { stage: "Later", xml: fs.readFileSync(path.join(builds, "Test - no EO.xml"), "utf8") }]));
  await ok("open_build", { name: "occ-vortex" });
  const guide = await ok("compare", { tree: "guide:Test:Later" });
  assert.match(guide, /-> Guide - Test \/ Later \(another build\)/);
  assert.match(guide, /REMOVED Elemental Overload/);
  assert.match(await ok("compare", { tree: "guide:Test:Start" }), /The trees are the same/);
  assert.match(await ok("compare", { tree: code }), /-> Pasted code[\s\S]*The trees are the same/);
  // Neither open: a pasted code against a saved build, stats and tree changes.
  const pair = await ok("compare", { a: code, b: "Test - no EO" });
  assert.match(pair, /STATS A -> B/);
  assert.match(pair, /TREE PLAN: Pasted code .*-> Test - no EO[\s\S]*REMOVED Elemental Overload/);
  const stages = await ok("compare", { a: "guide:Test:Start", b: "guide:Test:Later" });
  assert.match(stages, /TREE PLAN: Guide - Test \/ Start .*-> Guide - Test \/ Later[\s\S]*REMOVED Elemental Overload/);
  await fails("compare", { tree: "guide:Nope" }, /No guide "Nope"/);
});

test("the Tree tab's planner (colours, legend, hover, order, apply, paste) in the headless engine", async () => {
  const { spawnSync } = await import("node:child_process");
  const zlib = await import("node:zlib");
  const root = path.join(here, "..", "..");
  const src = path.join(root, "PathOfBuilding", "src");
  const runtime = path.join(root, "PathOfBuilding", "runtime");
  const exe = path.join(root, "luajit", process.platform === "win32" ? "luajit.exe" : "luajit");
  const codeFile = path.join(tmp, "code.txt");
  fs.writeFileSync(codeFile, zlib.deflateSync(fs.readFileSync(path.join(here, "fixtures", "occ-vortex.xml"))).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"));
  const env = {
    ...process.env,
    LUA_PATH: `${path.join(runtime, "lua", "?.lua")};${path.join(runtime, "lua", "?", "init.lua")};;`,
    LUA_CPATH: `${path.join(runtime, process.platform === "win32" ? "?.dll" : "?.so")};;`,
  };
  const r = spawnSync(exe, [path.join(here, "treeplan.lua"), path.join(here, "fixtures", "occ-vortex.xml"), codeFile], { cwd: src, env, encoding: "utf8", timeout: 300_000 });
  assert.equal(r.status, 0, `treeplan.lua failed:
${r.stdout}
${r.stderr.slice(-2000)}`);
  assert.match(r.stdout, /treeplan ok: \d+ checks/);
});

test("point at it: without the PoB window nothing is opened; the answer says where things are", async () => {
  await ok("open_build", { name: "occ-vortex" });
  const text = await ok("set_view", { view: "TREE", point: [{ target: "Ash, Frost and Storm", text: "take this next" }, { target: "Helmet" }, { target: "Vortex", kind: "gem" }, "zzzz nothing"] });
  assert.match(text, /The PoB window is not open, so nothing was marked \(no window was opened\)/);
  assert.match(text, /1\. Ash, Frost and Storm \(node, passive tree, \d+ points? from your tree\): take this next/);
  assert.match(text, /2\. Helmet: Heretic's Veil.*\(slot, Items tab\)/);
  assert.match(text, /3\. Vortex \(group \d+\) \(gem, Skills tab\)/);
  assert.match(await ok("set_view", { view: "TREE", point: { marks: ["Helmet", "Vortex"], tour: true } }), /not open[\s\S]*1\. Helmet/);
  assert.match(text, /Not found: nothing called "zzzz nothing"/);
});

test("point at it: every target type resolves, is stored, drawn and cleared (headless engine)", async () => {
  const { spawnSync } = await import("node:child_process");
  const root = path.join(here, "..", "..");
  const src = path.join(root, "PathOfBuilding", "src");
  const runtime = path.join(root, "PathOfBuilding", "runtime");
  const exe = path.join(root, "luajit", process.platform === "win32" ? "luajit.exe" : "luajit");
  const env = {
    ...process.env,
    LUA_PATH: `${path.join(runtime, "lua", "?.lua")};${path.join(runtime, "lua", "?", "init.lua")};;`,
    LUA_CPATH: `${path.join(runtime, process.platform === "win32" ? "?.dll" : "?.so")};;`,
  };
  const r = spawnSync(exe, [path.join(here, "point.lua"), path.join(here, "fixtures", "occ-vortex.xml"), fs.mkdtempSync(path.join(os.tmpdir(), "agent-point-"))], { cwd: src, env, encoding: "utf8", timeout: 300_000 });
  assert.equal(r.status, 0, `point.lua failed:\n${r.stdout}\n${r.stderr.slice(-2000)}`);
  assert.match(r.stdout, /point ok: \d+ checks/);
});
