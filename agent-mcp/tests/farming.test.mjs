// Farming & money advisor tests (roadmap Stage 8): the cited data file, the capability
// rules, PoB's farming_check / farming_atlas on a headless fixture build, atlas { farm },
// session logs, the money plan, SSF and the read-only chat guard. Offline: poe.ninja is
// faked (fetch is stubbed) and the profile names the league, so no trade request is made.
// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-farming-"));
const builds = path.join(tmp, "Builds");
fs.mkdirSync(builds);
fs.copyFileSync(path.join(here, "fixtures", "occ-vortex.xml"), path.join(builds, "occ-vortex.xml"));
const settings = path.join(tmp, "AgentEdition.json");
process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = builds;
process.env.POB_AGENT_SETTINGS = settings;
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";
const setProfile = (profile) => fs.writeFileSync(settings, JSON.stringify({ profile }));
setProfile({ playMode: "trade", league: "Testleague", currency: { chaos: 100, divine: 1 } });

// --- fake poe.ninja (exchange categories) ---------------------------------------------------
const EXCHANGE = {
  Currency: [["Divine Orb", 200], ["Test Unrelated Orb", 9000]],
  Fragment: [["Breach Thread", 4], ["Legion Thread", 2], ["Timeless Test Emblem", 50], ["Timeless Test Splinter", 0.5], ["Simulacrum", 80]],
  Artifact: [["Test Artifact", 3]], Omen: [["Omen of Testing", 25]], Oil: [["Test Oil", 1]], Essence: [["Test Essence", 2]], DeliriumOrb: [["Test Delirium Orb", 6]],
};
const requests = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  requests.push(u);
  if (!u.startsWith("https://poe.ninja/")) throw new Error(`test made an unexpected request: ${u}`);
  const type = new URL(u).searchParams.get("type");
  if (u.includes("/exchange/")) {
    const rows = EXCHANGE[type] ?? [];
    return Response.json({ core: { primary: "chaos", items: [] }, items: rows.map(([name], i) => ({ id: `i${i}`, name })), lines: rows.map(([, v], i) => ({ id: `i${i}`, primaryValue: v })) });
  }
  return Response.json({ lines: [] });
};

const { FARMING_DATA: D } = await import("../build/farming/data.js");
const cap = await import("../build/farming/capability.js");
const log = await import("../build/farming/log.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();
after(() => context.pob.close());
const call = async (name, args = {}) => { const r = await runTool(tools, context, name, args); if (r.isError) throw new Error(r.text); return r.text; };

describe("data file (cited, current)", () => {
  test("every fact and strategy names a known source and keeps its quote", () => {
    assert.match(D.version, /^3\.\d+\.\d+$/);
    const walk = (v) => {
      if (!v || typeof v !== "object") return;
      if ("quote" in v) { assert.ok(D.sources[v.src], `unknown source ${v.src}`); assert.ok(v.quote.length > 10); }
      for (const x of Object.values(v)) walk(x);
    };
    walk(D.facts);
    walk(D.strategies);
    for (const s of Object.values(D.sources)) assert.match(s.url, /^https:\/\/(www\.poewiki\.net|www\.pathofexile\.com)\//);
    assert.ok(D.rules.note.includes("not game facts"));
  });

  test("map tiers 1-16 map to area levels 68-83; strategies are the Thread mechanics plus Essence and Delirium", () => {
    const tiers = cap.tierLevels();
    assert.equal(tiers.length, 16);
    assert.deepEqual([tiers[0].level, tiers[15].level], [68, 83]);
    assert.equal(D.strategies.filter((s) => s.thread).length, 10);
    assert.ok(D.strategies.some((s) => s.id === "essence") && D.strategies.some((s) => s.id === "delirium"));
    assert.equal(D.facts.voidstones.length, 4);
  });
});

describe("capability rules", () => {
  test("hits to die: hardcore needs more margin; rare kill time uses PoB life x the wiki's rare multiplier", () => {
    assert.equal(cap.survival(5, false), "safe");
    assert.equal(cap.survival(5, true), "risky");
    assert.equal(cap.survival(1, false), "unsafe");
    const life = cap.rareLife(83, 1000);
    assert.equal(life, 1000 * (1 + D.facts.rareLife.byLevel["83"] / 100));
    assert.equal(cap.clearVerdict(cap.killTime(life, life)), "safe");
  });

  test("mods to avoid keep only those past the threshold, worst first", () => {
    const mods = [
      { name: "A", kind: "prefix", text: "a", dpsPct: -5 },
      { name: "B", kind: "suffix", text: "b", hitsPct: -40 },
      { name: "C", kind: "prefix", text: "c", dpsPct: -20, maxHitPct: -2 },
    ];
    assert.deepEqual(cap.modsToAvoid(mods).map((m) => m.name), ["B", "C"]);
  });
});

describe("PoB side (headless fixture build)", () => {
  test("farming_check simulates tiers, bosses and map mods and leaves the build as it was", async () => {
    await call("open_build", { name: "occ-vortex" });
    const link = await context.pob.link();
    const before = (await link.call("key_stats")).stats;
    const r = await link.call("farming_check", { levels: [68, 83], mods: true });
    assert.equal(r.tiers.length, 2);
    assert.ok(r.tiers[0].monsterLife < r.tiers[1].monsterLife);
    assert.ok(r.tiers.every((t) => t.hits > 0 && t.clearDps > 0));
    assert.ok(r.mods.length > 20, "PoB's map mods are simulated");
    assert.ok(r.mods.some((m) => (m.recoveryPct ?? 0) < -50), "a no-regen / less-recovery mod shows up");
    assert.ok(r.pinnacle.hits > r.uber.hits);
    assert.equal(r.rollbackProblem, undefined);
    assert.deepEqual((await link.call("key_stats")).stats, before);
    assert.match(await call("status"), /no unsaved changes|saved/i);
  });

  test("farming_atlas: presets reach notables of the mechanic only, keystones listed apart, atlas untouched", async () => {
    const link = await context.pob.link();
    const r = await link.call("farming_atlas", { mechanics: ["Legion"], keys: { Legion: "Legion|Timeless" }, points: 20 });
    const p = r.presets[0];
    assert.equal(p.mechanic, "Legion");
    assert.ok(p.points <= 20 && p.ids.length === p.points);
    assert.ok(p.picks.length > 0 && p.picks.every((k) => /legion|timeless/i.test(`${k.name} ${k.stats.join(" ")}`)));
    assert.ok(!p.picks.some((k) => k.type === "keystone"));
    assert.equal((await link.call("atlas_get")).result.pointsUsed, r.pointsUsed);
  });
});

describe("atlas { farm }", () => {
  test("capability, strategies with presets and Thread prices, progression, sources; no invented profit", async () => {
    const t = await call("atlas", { farm: "true" });
    for (const h of ["1. WHAT THE BUILD CAN DO", "2. STRATEGIES", "3. PROGRESSION PATH", "4. MONEY PLAN", "Sources"]) assert.ok(t.includes(h), h);
    assert.match(t, /T16 \(red, area level 83\)/);
    assert.match(t, /Apply: atlas \{ add: \["\d+"/);
    assert.match(t, /Profit per hour: not measured yet/);
    assert.doesNotMatch(t, /\d+c\/h/);
    assert.match(t, /poewiki\.net\/wiki\/Voidstone/);
    assert.match(t, /Config assumptions:/);
    assert.ok(requests.every((u) => u.startsWith("https://poe.ninja/")));
  });

  test("one strategy: Thread investment and outputs from its own poe.ninja category only", async () => {
    const t = await call("atlas", { farm: "legion" });
    assert.match(t, /Legion Thread 2(\.0)?c each/);
    assert.match(t, /Timeless Test Emblem 50c/);
    assert.doesNotMatch(t, /Test Unrelated Orb/);
    const e = await call("atlas", { farm: "expedition" });
    assert.match(e, /Test Artifact 3(\.0)?c/);
    assert.doesNotMatch(e, /Test Unrelated Orb/);
  });

  test("log a session, then measured profit and the money plan in hours", async () => {
    const r = await call("atlas", { log: { strategy: "legion", maps: 10, minutes: 60, chaos: 500, spent: 100 } });
    assert.match(r, /400c\/hour net/);
    assert.equal(log.measuredRate("legion", "Testleague").perHour, 400);
    const t = await call("atlas", { farm: "legion", goal: "5 div" });
    assert.match(t, /5 div = 1,000c; on hand 300c \(profile\); still needed 700c/);
    assert.match(t, /Legion: about 1\.8 hours at your measured 400c\/h/);
    assert.match(t, /measured by you/);
  });

  test("bad input says what to give", async () => {
    const r = await runTool(tools, context, "atlas", { farm: "nonsense" });
    assert.ok(r.isError && /Strategies: breach/.test(r.text));
    const l = await runTool(tools, context, "atlas", { log: { strategy: "legion" } });
    assert.ok(l.isError && /minutes/.test(l.text));
  });

  test("SSF: no money plan or purchases, farm targets instead", async () => {
    setProfile({ playMode: "ssf", league: "Testleague", currency: { chaos: 0, divine: 0 } });
    try {
      const t = await call("atlas", { farm: "true", goal: "5 div" });
      assert.match(t, /4\. SSF: FARM FOR WHAT THE BUILD NEEDS/);
      assert.doesNotMatch(t, /MONEY PLAN/);
      assert.match(t, /Frayed Thread/);
    } finally {
      setProfile({ playMode: "trade", league: "Testleague", currency: { chaos: 100, divine: 1 } });
    }
  });

  test("read-only chat: the advisor and logs work, applying a preset is refused", async () => {
    process.env.POB_READ_ONLY = "1";
    try {
      assert.equal((await runTool(tools, context, "atlas", { farm: "breach" })).isError, false);
      const r = await runTool(tools, context, "atlas", { add: ["1"] });
      assert.ok(r.isError && /Edits are off/.test(r.text));
    } finally {
      delete process.env.POB_READ_ONLY;
    }
  });
});
