// Oil prices (0.9.1): poe.ninja keeps oils in their own "Oils" category, not under Currency.
// prices { search: "oil" } and prices { name: "Golden Oil" } read it; anoint costs add it up.
// Offline: poe.ninja is faked (fetch is stubbed) and the profile names the league, so no
// trade request is made. Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-oils-"));
fs.mkdirSync(path.join(tmp, "Builds"));
process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = path.join(tmp, "Builds");
process.env.POB_AGENT_SETTINGS = path.join(tmp, "AgentEdition.json");
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_UPDATE_CHECK = "off";
fs.writeFileSync(process.env.POB_AGENT_SETTINGS, JSON.stringify({ profile: { playMode: "trade", league: "Testleague" } }));

// The shape poe.ninja's exchange overview has today: names in items[], prices in lines[] (chaos = primary).
const OILS = [["Golden Oil", 26.54], ["Silver Oil", 10.34], ["Black Oil", 3.14], ["Amber Oil", 0.1631], ["Teal Oil", 0.4603], ["Clear Oil", 0.069]];
const requests = [];
let ninjaDown = false;
globalThis.fetch = async (url) => {
  const u = String(url);
  requests.push(u);
  if (!u.startsWith("https://poe.ninja/")) throw new Error(`test made an unexpected request: ${u}`);
  if (ninjaDown) return new Response("down", { status: 503 });
  const type = new URL(u).searchParams.get("type");
  const rows = type === "Oil" ? OILS : type === "Currency" ? [["Divine Orb", 150]] : [];
  return Response.json({
    core: { primary: "chaos", items: [{ id: "chaos", name: "Chaos Orb" }] },
    items: rows.map(([name]) => ({ id: name.toLowerCase().replace(/ /g, "-"), name, category: type === "Oil" ? "Oils" : "Currency" })),
    lines: rows.map(([name, v]) => ({ id: name.toLowerCase().replace(/ /g, "-"), primaryValue: v })),
  });
};

const ninja = await import("../build/trade/ninja.js");
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();
after(() => context.pob.close());
const call = async (name, args = {}) => { const r = await runTool(tools, context, name, args); if (r.isError) throw new Error(r.text); return r.text; };

test("oil names and recipe cost", () => {
  assert.equal(ninja.oilName("AmberOil"), "Amber Oil");
  assert.equal(ninja.oilName("Golden Oil"), "Golden Oil");
  const prices = new Map(OILS);
  const c = ninja.recipeCost(["AmberOil", "TealOil", "GoldenOil"], prices);
  assert.deepEqual(c.parts.map((p) => p.name), ["Amber Oil", "Teal Oil", "Golden Oil"]);
  assert.ok(Math.abs(c.total - (0.1631 + 0.4603 + 26.54)) < 1e-9);
  assert.equal(ninja.recipeText(c), "Amber Oil 0.16c + Teal Oil 0.46c + Golden Oil 27c = 27c");
  const missing = ninja.recipeCost(["GoldenOil", "TestOil"], prices);
  assert.equal(missing.total, undefined);
  assert.deepEqual(missing.missing, ["Test Oil"]);
});

test("prices { search: \"oil\" } lists oils from poe.ninja's Oils category, dearest first", async () => {
  const text = await call("prices", { search: "oil" });
  assert.doesNotMatch(text, /No currency/);
  assert.match(text, /Currency rates in Testleague/);
  assert.match(text, /- Golden Oil: 27c\n- Silver Oil: 10c\n- Black Oil: 3\.1c/);
  assert.match(text, /- Clear Oil: 1\/14\.5c/);
  assert.ok(requests.some((u) => u.includes("/exchange/") && u.includes("type=Oil") && u.includes("league=Testleague")));
  assert.ok(requests.every((u) => u.startsWith("https://poe.ninja/")), "no trade request");
});

test("prices { name: \"Golden Oil\" } answers from poe.ninja without a trade search, cached", async () => {
  const before = requests.length;
  const text = await call("prices", { name: "Golden Oil" });
  assert.match(text, /^Golden Oil in Testleague: 27c each \(poe\.ninja Oils, \d{4}-\d\d-\d\d \d\d:\d\d UTC\)/);
  assert.match(text, /prices \{ search: "oil" \}/);
  assert.equal(requests.length, before, "second oil lookup comes from the cache");
  const lower = await call("prices", { name: "amber oil" });
  assert.match(lower, /^Amber Oil in Testleague: 0\.16c each/);
});

test("the oil list is cached on disk per league; the cached copy is used while poe.ninja is down", async () => {
  const file = path.join(process.env.POB_AGENT_CACHE, "economy", "exchange-Testleague-Oil.json");
  assert.ok(fs.existsSync(file));
  ninjaDown = true;
  try {
    const text = await call("prices", { search: "silver oil" });
    assert.match(text, /- Silver Oil: 10c/);
  } finally { ninjaDown = false; }
});
