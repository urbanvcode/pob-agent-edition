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
  assert.match(row(sub, `-${EO}`), /^ \[ \] /);
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
