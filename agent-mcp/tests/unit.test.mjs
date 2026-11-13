// Unit tests: no PoB and no network needed. Run with: npm run test:unit
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-unit-"));
process.env.POB_AGENT_SETTINGS = path.join(tmp, "AgentEdition.json");
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_LIVE = "off";

const { createTools, toolDefinitions } = await import("../build/server.js");
const { AGENT_GUIDE } = await import("../build/guide.js");
const profile = await import("../build/profile.js");
const { RateGovernor, parseRules, parseState, policyForUrl } = await import("../build/trade/rateGovernor.js");
const { TradeApiClient } = await import("../build/trade/client.js");
const { evaluateCandidate, INSTANT_BUYOUT, missingResists, resistQuery } = await import("../build/trade/upgrades.js");
const { tradeItemToPoBText, priceInChaos } = await import("../build/trade/itemText.js");
const { parseRates } = await import("../build/trade/ninja.js");
const { findStat, challengeLeague } = await import("../build/tools/trade.js");
const { decodeBuildCode, encodeBuildCode, buildFile } = await import("../build/tools/session.js");
const { bossText } = await import("../build/tools/read.js");
const { deltaLines } = await import("../build/format.js");

const { tools } = createTools();
const defs = toolDefinitions(tools);

/** Rough token count: characters / 4 (the usual estimate for English + JSON). */
const tokens = (value) => Math.ceil(JSON.stringify(value).length / 4);

test("tool definitions stay within the 5,000 token budget", () => {
  const total = tokens(defs);
  assert.ok(total <= 5000, `tool definitions are about ${total} tokens (budget 5,000)`);
});

test("agent guide stays short", () => {
  assert.ok(Math.ceil(AGENT_GUIDE.length / 4) <= 1200, "agent guide is over 1,200 tokens");
});

test("the agreed tool list is complete and nothing else is exposed", () => {
  const expected = [
    "profile_get", "profile_set", "profile_mark_learned",
    "status", "list_builds", "open_build", "save_build", "set_view", "open_options",
    "build_summary", "stats", "diagnose", "tree_search",
    "edit_items", "edit_skills", "edit_tree", "set_config", "what_if", "snapshot", "restore", "compare",
    "suggest_passives", "anoint", "affixes", "suggest_gems", "suggest_jewels",
    "leagues", "trade_search", "plan_upgrades", "currency", "price_check",
    "atlas_get", "atlas_search", "atlas_edit",
  ];
  assert.deepEqual(defs.map((d) => d.name), expected);
  for (const d of defs) {
    assert.equal(d.inputSchema.type, "object");
    assert.ok(d.description.length >= 20 && d.description.length <= 460, `${d.name}: description length ${d.description.length}`);
  }
});

test("the guide and tool texts only name tools that exist", () => {
  const names = new Set(defs.map((d) => d.name));
  const old = ["live_status", "lua_get_stats", "get_build_issues", "analyze_defenses", "live_save_build", "live_set_view", "lua_load_build", "get_leagues", "live_open_build"];
  const text = AGENT_GUIDE + JSON.stringify(defs);
  for (const name of old) assert.ok(!text.includes(name), `old tool name ${name} is still mentioned`);
  for (const name of ["profile_get", "status", "diagnose", "what_if", "save_build", "plan_upgrades", "atlas_get"]) {
    assert.ok(names.has(name) && AGENT_GUIDE.includes(name), `${name} missing from guide or tools`);
  }
});

test("profile: defaults, updates, learned topics, other keys kept", () => {
  fs.writeFileSync(process.env.POB_AGENT_SETTINGS, JSON.stringify({ POESESSID: "abc123", other: 1 }));
  let p = profile.getProfile();
  assert.equal(p.stored, false);
  assert.equal(p.profile.playMode, "trade");
  assert.equal(p.profile.explanationMode, "teach");
  const r = profile.updateProfile({ playMode: "ssf", hardcore: true, league: " Standard ", currency: { chaos: 300.4, divine: -2 }, add_goals: ["Kill Uber Elder", "kill uber elder"] });
  assert.deepEqual(r.changed.sort(), ["currency", "goals", "hardcore", "league", "playMode"]);
  p = profile.getProfile();
  assert.equal(p.stored, true);
  assert.equal(p.profile.league, "Standard");
  assert.equal(p.profile.currency.chaos, 300);
  assert.equal(p.profile.currency.divine, 0);
  assert.deepEqual(p.profile.goals, ["Kill Uber Elder"]);
  assert.throws(() => profile.updateProfile({ playMode: "nope" }), /playMode must be one of/);
  assert.deepEqual(profile.markLearned(["Spell Suppression", "spell suppression"]).added, ["Spell Suppression"]);
  assert.deepEqual(profile.markLearned(["spell suppression"]).added, []);
  const raw = JSON.parse(fs.readFileSync(process.env.POB_AGENT_SETTINGS, "utf8"));
  assert.equal(raw.POESESSID, "abc123");
  assert.equal(raw.other, 1);
  const rules = profile.answerRules(p.profile).join("\n");
  assert.match(rules, /SSF/);
  assert.match(rules, /HARDCORE/);
  assert.equal(profile.getPoeSessionId(), "abc123");
  // The session id never appears in anything a tool prints.
  assert.ok(!profile.formatProfile(p.profile, process.env.POB_AGENT_SETTINGS, true).includes("abc123"));
});

test("profile schema matches PoB's Settings.lua", () => {
  const lua = fs.readFileSync(new URL("../../PathOfBuilding/src/Agent/Settings.lua", import.meta.url), "utf8");
  for (const key of ["playMode", "hardcore", "league", "currency", "goals", "experience", "explanationMode", "learnedTopics"]) {
    assert.ok(lua.includes(key), `Settings.lua does not mention ${key}`);
  }
  for (const value of ["trade", "ssf", "mixed", "teach", "concise", "deep", "poe2", "poe1"]) assert.ok(lua.includes(`${value}`), `Settings.lua lacks ${value}`);
});

test("rate governor: keeps one slot free in every tier and honours the server", () => {
  let now = 1_000_000;
  const g = new RateGovernor(() => now);
  assert.equal(policyForUrl("https://www.pathofexile.com/api/trade/search/Standard"), "search");
  assert.equal(policyForUrl("https://www.pathofexile.com/api/trade/fetch/a,b"), "fetch");
  assert.deepEqual(parseRules("8:10:60,15:60:120"), [{ max: 8, periodSec: 10 }, { max: 15, periodSec: 60 }]);
  assert.deepEqual(parseState("1:10:0")[0], { hits: 1, periodSec: 10, restrictedSec: 0 });
  // Default search limits are 5 per 10 s; the governor uses at most 4.
  for (let i = 0; i < 4; i++) { assert.equal(g.waitMs("search"), 0); g.record("search"); now += 100; }
  assert.ok(g.waitMs("search") > 9000, "the 5th request in 10 s must wait");
  now += 10_000;
  assert.equal(g.waitMs("search"), 0);
  // A server restriction blocks everything until it expires.
  const headers = new Map([["X-Rate-Limit-Rules", "Ip"], ["X-Rate-Limit-Ip", "8:10:60"], ["X-Rate-Limit-Ip-State", "9:10:60"]]);
  g.update("search", { get: (k) => headers.get(k) ?? null });
  assert.ok(g.blockedForSec() >= 59);
  assert.ok(g.waitMs("fetch") >= 59_000);
  // 429 without Retry-After pauses for a minute.
  const g2 = new RateGovernor(() => now);
  g2.update("search", { get: () => null }, 429);
  assert.equal(g2.blockedForSec(), 60);
});

test("trade client: 16 requests per question, 2 s pacing, cookie only for pathofexile.com", async () => {
  const src = fs.readFileSync(new URL("../src/trade/client.ts", import.meta.url), "utf8");
  assert.match(src, /maxRequestsPerCall \?\? 16/);
  assert.match(src, /requestsPerSecond : 0\.5/);
  assert.match(src, /hostname === 'www\.pathofexile\.com' \? getPoeSessionId\(\) : undefined/);
  assert.equal(INSTANT_BUYOUT, "securable");
  // The request budget stops the 17th network request of one question.
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ id: "x", result: [], total: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  try {
    const client = new TradeApiClient({ requestsPerSecond: 1000, maxRequestsPerCall: 3, governor: new RateGovernor(() => Date.now(), -1000) });
    client.beginCall();
    for (let i = 0; i < 3; i++) await client.searchItems("Standard", { query: { term: `q${i}` } });
    await assert.rejects(client.searchItems("Standard", { query: { term: "q4" } }), /Stopped after 3 trade requests/);
    assert.equal(calls, 3);
    // Cached answers are free.
    await client.searchItems("Standard", { query: { term: "q1" } });
    assert.equal(calls, 3);
    // 429 is never retried.
    client.beginCall();
    globalThis.fetch = async () => { calls++; return new Response("slow down", { status: 429, headers: { "Retry-After": "5" } }); };
    await assert.rejects(client.searchItems("Standard", { query: { term: "q9" } }), /slow down/);
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("only instant-buyout listings are ever searched", () => {
  for (const file of ["tools/trade.ts", "trade/upgrades.ts"]) {
    const src = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    const statuses = [...src.matchAll(/status\s*[:=]\s*\{\s*option:\s*([^}\s]+)/g)].map((m) => m[1]);
    assert.ok(statuses.length > 0, `${file} sets no status`);
    for (const s of statuses) assert.equal(s, "INSTANT_BUYOUT", `${file} uses status ${s}`);
    assert.ok(!/whisper/i.test(src.replace(/never whispers?/gi, "")), `${file} mentions whispers`);
  }
});

test("upgrade scoring: gains, resist notes and warnings", () => {
  const base = { CombinedDPS: 1000, TotalEHP: 10000, Life: 4000, FireResist: 75, ColdResist: 60, LightningResist: 75, ChaosResist: 0, Str: 100, ReqStr: 50, ManaUnreserved: 50 };
  const better = evaluateCandidate(base, { ...base, CombinedDPS: 1100, TotalEHP: 10500, Life: 4100, ColdResist: 75 }, "balanced");
  assert.ok(Math.abs(better.dpsPct - 10) < 1e-9);
  assert.ok(Math.abs(better.ehpPct - 5) < 1e-9);
  assert.equal(better.lifeDelta, 100);
  assert.deepEqual(better.resNotes, ["Cold res 60% -> 75%"]);
  assert.ok(better.score > 10);
  // An attribute that was already short and did not get worse is not the item's fault.
  assert.deepEqual(evaluateCandidate({ ...base, Str: 40 }, { ...base, Str: 45 }, "dps").warnings, []);
  const worse = evaluateCandidate(base, { ...base, CombinedDPS: 1200, FireResist: 40, Str: 40 }, "dps");
  assert.deepEqual(worse.warnings, ["Fire res drops to 40%", "Str requirement not met (40/50)"]);
  assert.ok(worse.score < 20 - 10);
});

test("trade listing -> PoB item text, prices in chaos", () => {
  const text = tradeItemToPoBText({
    id: "1", name: "Doom Knot", typeLine: "Two-Stone Ring", frameType: 2, ilvl: 84,
    implicitMods: ["+(12-16)% to [Fire|Fire] and Cold Resistances"], explicitMods: ["+70 to maximum Life"], craftedMods: ["+10 to Strength"], corrupted: true,
    sockets: [{ group: 0, sColour: "R" }, { group: 0, sColour: "G" }, { group: 1, sColour: "B" }],
  });
  assert.equal(text, ["Rarity: RARE", "Doom Knot", "Two-Stone Ring", "Item Level: 84", "Sockets: R-G B", "Implicits: 1", "+(12-16)% to Fire and Cold Resistances", "+70 to maximum Life", "{crafted}+10 to Strength", "Corrupted"].join("\n"));
  const rates = new Map([["Chaos Orb", 1], ["Divine Orb", 150]]);
  assert.equal(priceInChaos({ amount: 2, currency: "divine" }, rates), 300);
  assert.equal(priceInChaos({ amount: 5, currency: "chaos" }, rates), 5);
  assert.equal(priceInChaos({ amount: 5, currency: "mystery" }, rates), undefined);
  assert.equal(parseRates({ lines: [{ currencyTypeName: "Divine Orb", chaosEquivalent: 140 }] }).get("Divine Orb"), 140);
  assert.equal(parseRates({ core: { primary: "divine" }, items: [{ id: "c", name: "Chaos Orb" }, { id: "d", name: "Divine Orb" }], lines: [{ id: "c", primaryValue: 0.01 }, { id: "d", primaryValue: 1 }] }).get("Divine Orb"), 100);
});

test("trade stat lookup by text", () => {
  const data = { result: [
    { id: "pseudo", label: "Pseudo", entries: [{ id: "pseudo.pseudo_total_life", text: "+# total maximum Life", type: "pseudo" }] },
    { id: "explicit", label: "Explicit", entries: [
      { id: "explicit.stat_3299347043", text: "+# to maximum Life", type: "explicit" },
      { id: "explicit.stat_4220027924", text: "+#% to Cold Resistance", type: "explicit" },
    ] },
  ] };
  assert.equal(findStat(data, "+70 to maximum Life").id, "explicit.stat_3299347043");
  assert.equal(findStat(data, "total maximum life").id, "pseudo.pseudo_total_life");
  assert.equal(findStat(data, "maximum life").id, "pseudo.pseudo_total_life");
  assert.equal(findStat(data, "explicit: maximum life").id, "explicit.stat_3299347043");
  assert.equal(findStat(data, "explicit.stat_123").id, "explicit.stat_123");
  assert.deepEqual(findStat(data, "frost resistance").suggestions, ["explicit: +#% to Cold Resistance"]);
});

test("current challenge league detection", () => {
  const ids = ["Mirage", "Hardcore Mirage", "Standard", "Hardcore", "SSF Mirage", "Ruthless Mirage"];
  assert.equal(challengeLeague(ids, false), "Mirage");
  assert.equal(challengeLeague(ids, true), "Hardcore Mirage");
  assert.equal(challengeLeague(["Standard", "Hardcore"], false), "Standard");
  assert.equal(challengeLeague(["Standard", "Hardcore"], true), "Hardcore");
});

test("build codes and build file names", () => {
  const xml = '<PathOfBuilding><Build level="1"/></PathOfBuilding>';
  const code = zlib.deflateSync(Buffer.from(xml)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  assert.equal(decodeBuildCode(code), xml);
  assert.equal(decodeBuildCode(encodeBuildCode(xml)), xml);
  assert.ok(!/[+/]/.test(encodeBuildCode(xml)), "export codes are base64url");
  assert.equal(decodeBuildCode(`  ${xml}`), xml);
  assert.throws(() => decodeBuildCode("not a code"), /not a valid PoB export code/);
  assert.throws(() => decodeBuildCode("https://pobb.in/abc"), /Links are not fetched/);
  const dir = path.join(tmp, "Builds");
  assert.equal(buildFile(dir, "My Build"), path.join(dir, "My Build.xml"));
  assert.equal(buildFile(dir, "sub/My Build.xml"), path.join(dir, "sub", "My Build.xml"));
  assert.throws(() => buildFile(dir, "../../evil"), /inside the Builds folder/);
  assert.throws(() => buildFile(dir, "a<b"), /does not allow/);
});

test("before/after lines only list what changed", () => {
  const lines = deltaLines({ CombinedDPS: 1000, Life: 4000, FireResist: 60, FullDPS: 0 }, { CombinedDPS: 1100, Life: 4000, FireResist: 75, FullDPS: 0 });
  assert.deepEqual(lines, ["Combined DPS: 1,000 -> 1,100 (+10.0%)", "Fire res %: 60 -> 75 (+15)"]);
});

test("resist fixing: what is missing and the trade query for it", () => {
  const missing = missingResists({ MissingFireResist: 22.4, MissingColdResist: 0, MissingLightningResist: 40, MissingChaosResist: 19 }, true);
  assert.deepEqual(missing, { Fire: 22, Cold: 0, Lightning: 40, Chaos: 19 });
  assert.equal(missingResists({ MissingChaosResist: 19 }, false).Chaos, 0);
  const q = resistQuery("accessory.ring", missing, 30);
  assert.equal(q.query.status.option, "securable");
  assert.deepEqual(q.sort, { price: "asc" });
  assert.equal(q.query.filters.type_filters.filters.category.option, "accessory.ring");
  assert.equal(q.query.filters.trade_filters.filters.price.max, 30);
  const group = q.query.stats[0];
  assert.equal(group.type, "weight");
  // Only the resistances that are short are asked for; cold is capped.
  assert.deepEqual(group.filters.map((f) => f.id), ["pseudo.pseudo_total_fire_resistance", "pseudo.pseudo_total_lightning_resistance", "pseudo.pseudo_total_chaos_resistance"]);
  assert.equal(group.value.min, 45);
  assert.equal(resistQuery("accessory.ring", { Fire: 5, Cold: 0, Lightning: 0, Chaos: 0 }, 30).query.stats[0].value.min, 12);
});

test("boss check verdicts", () => {
  const base = { uber: false, dps: 1000000, mainSkill: "Arc", assumptions: "x" };
  const text = (hits) => bossText({ ...base, results: [{ skill: "Shaper Slam", taken: 9000, enemyDamage: 12000, hitsToDie: hits, takenByType: { Physical: 9000 } }, { skill: "Shaper Beam", overTime: true }] });
  assert.match(text(0.6), /DIES TO ONE HIT[\s\S]*Verdict: not ready/);
  assert.match(text(1.4), /survives one hit, not two[\s\S]*Verdict: risky/);
  assert.match(text(3.7), /survives 3 hits[\s\S]*Verdict: survivable/);
  assert.match(text(3.7), /Shaper Beam: damage over time/);
  assert.match(text(3.7), /no boss life data/);
});

test("update check: version compare, newest release, notice once and only when newer", async () => {
  const { compareVersions, pickLatest, updateNotice } = await import("../build/update.js");
  const { VERSION, portableMode } = await import("../build/paths.js");
  assert.equal(compareVersions("0.3.0", "0.2.0"), 1);
  assert.equal(compareVersions("v0.2.0", "0.2.0"), 0);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0-rc1", "1.0.0"), -1);
  assert.deepEqual(pickLatest([{ tag_name: "v0.2.0" }, { tag_name: "v0.9.0", draft: true }, { tag_name: "v0.3.1", html_url: "u" }, { tag_name: "nightly" }]), { version: "0.3.1", url: "u" });
  assert.equal(pickLatest({ message: "rate limited" }), null);
  // VERSION file at the root is the source of truth
  assert.equal(VERSION, fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "..", "VERSION"), "utf8").trim());
  assert.equal(portableMode(), fs.existsSync(path.join(process.cwd(), "..", "portable.txt")));

  const file = process.env.POB_AGENT_SETTINGS;
  const write = (update) => {
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    fs.writeFileSync(file, JSON.stringify({ ...data, update }));
  };
  const now = Math.floor(Date.now() / 1000);
  write({ checkedAt: now, latest: VERSION });
  assert.equal(updateNotice(), null, "same version: no notice");
  write({ checkedAt: now, latest: "99.0.0", skip: "99.0.0" });
  assert.equal(updateNotice(), null, "skipped version: no notice");
  write({ checkedAt: now, latest: "99.0.0", check: false });
  assert.equal(updateNotice(), null, "checking off: no notice");
  write({ checkedAt: now, latest: "99.0.0" });
  assert.match(updateNotice(), /Update available: PoB Agent Edition v99\.0\.0/);
  assert.equal(updateNotice(), null, "mentioned once per conversation");
});
