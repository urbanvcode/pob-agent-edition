// Stage 2 tests: character download (mocked pathofexile.com, no network), the diff
// engine, and character_sync / character_history against the headless engine.
// The sample character is a real public character with its names replaced.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-character-"));
const builds = path.join(tmp, "Builds");
fs.mkdirSync(builds);
process.env.POB_LIVE = "off";
process.env.POB_DIRECTORY = builds;
process.env.POB_AGENT_SETTINGS = path.join(tmp, "AgentEdition.json");
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");

const { createTools, runTool } = await import("../build/server.js");
const { characterTools } = await import("../build/tools/character.js");
const { CharacterClient, normaliseAccount, diffStates, diffSummary, readIndex } = await import("../build/character.js");
const { RateGovernor } = await import("../build/trade/rateGovernor.js");

const fx = (f) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", "character", f), "utf8"));
const characters = fx("characters.json");
let items = fx("items.json");
let passives = fx("passives.json");
// One white socket (fits any gem, gives no matching-colour quality): the Gloves' first, holding Frostblink.
items.items.find((i) => i.inventoryId === "Gloves").sockets[0].sColour = "W";

/** A fake pathofexile.com: records the URLs asked for. */
function fakeSite(overrides = {}) {
  const calls = [];
  const headers = (h = {}) => ({ get: (k) => h[k] ?? null });
  const fetcher = async (url) => {
    calls.push(url);
    if (overrides[url.split("?")[0].split("/").pop()]) return overrides[url.split("?")[0].split("/").pop()](url);
    const body = url.includes("get-characters") ? characters : url.includes("get-items") ? items : passives;
    return { status: 200, headers: headers({ "X-Rate-Limit-Rules": "Ip", "X-Rate-Limit-Ip": "15:60:120", "X-Rate-Limit-Ip-State": "1:60:0" }), text: async () => JSON.stringify(body) };
  };
  return { calls, fetcher, headers };
}

const { context } = createTools();
after(() => context.pob.close());
const site = fakeSite();
const tools = characterTools(new CharacterClient(site.fetcher, 0));
const call = (name, args = {}) => runTool(tools, context, name, args);
async function ok(name, args) { const r = await call(name, args); assert.equal(r.isError, false, r.text); return r.text; }

test("account names are cleaned like PoB's importer", () => {
  assert.equal(normaliseAccount(" Sample-0000 "), "Sample#0000");
  assert.equal(normaliseAccount("Sam ple#0000"), "Sample#0000");
  assert.equal(normaliseAccount("Some Name", "xbox"), "Some+Name");
});

test("private profile, unknown character and 429 give clear messages", async () => {
  const priv = fakeSite({ "get-characters": async () => ({ status: 403, headers: { get: () => null }, text: async () => "<html>" }) });
  await assert.rejects(new CharacterClient(priv.fetcher, 0).download("Sample#0000", "x"), /private or does not exist[\s\S]*Privacy Settings/);
  await assert.rejects(new CharacterClient(fakeSite().fetcher, 0).download("Sample#0000", "Nobody"), /no character "Nobody"[\s\S]*SampleDeadeye \(92 Deadeye/);
  const busy = fakeSite({ "get-items": async () => ({ status: 429, headers: { get: (k) => (k === "Retry-After" ? "30" : null) }, text: async () => "" }) });
  const client = new CharacterClient(busy.fetcher, 0);
  await assert.rejects(client.download("Sample#0000", "SampleDeadeye"), /asked for a pause \(429\)/);
  await assert.rejects(client.download("Sample#0000", "SampleDeadeye"), /asked for a pause: wait \d+ s/);
  assert.equal(busy.calls.length, 2, "nothing is sent while the site asked for a pause");
});

test("the rate governor holds requests back before the server's limit", () => {
  let now = 0;
  const g = new RateGovernor(() => now);
  g.update("character", { get: (k) => ({ "X-Rate-Limit-Rules": "Ip", "X-Rate-Limit-Ip": "15:60:120", "X-Rate-Limit-Ip-State": "0:60:0" })[k] ?? null }, 200);
  for (let i = 0; i < 14; i++) { assert.equal(g.waitMs("character"), 0); g.record("character"); now += 100; }
  assert.ok(g.waitMs("character") > 50_000, "the 15th request in a minute waits (one slot of headroom)");
});

test("diff engine: items, gems, passives and stats", () => {
  const base = {
    level: 90, stats: { CombinedDPS: 1000, TotalEHP: 5000, Life: 3000, FireResist: 75, PhysicalMaximumHitTaken: 4000, ChaosMaximumHitTaken: 3000 },
    items: [{ slot: "Helmet", name: "Old Hat", base: "Iron Hat", mods: "a" }, { slot: "Ring 1", name: "Ring", mods: "x" }, { slot: "Boots", name: "B", mods: "1" }],
    gems: [{ name: "Fireball", level: 19, quality: 0 }, { name: "Added Fire Damage Support", level: 20, quality: 20 }],
    nodes: [1, 2, 3, 4], named: { 1: "Notable A", 4: "Fire Mastery: +10% fire" },
  };
  const next = {
    level: 92, stats: { CombinedDPS: 1500, TotalEHP: 4500, Life: 3100, FireResist: 70, PhysicalMaximumHitTaken: 4200, ChaosMaximumHitTaken: 2500 },
    items: [{ slot: "Helmet", name: "New Hat", base: "Iron Hat", mods: "b" }, { slot: "Ring 1", name: "Ring", mods: "y" }, { slot: "Gloves", name: "G", mods: "2" }],
    gems: [{ name: "Fireball", level: 20, quality: 5 }, { name: "Elemental Focus Support", level: 1, quality: 0 }],
    nodes: [2, 3, 4, 5, 6], named: { 5: "Keystone K", 4: "Fire Mastery: +20% fire" },
  };
  const d = diffStates(base, next);
  assert.deepEqual(d.level, [90, 92]);
  assert.deepEqual(d.items.sort(), ["Boots: removed B", "Gloves: new G", "Helmet: Old Hat (Iron Hat) -> New Hat (Iron Hat)", "Ring 1: Ring has changed mods (crafted, rerolled or a different copy)"]);
  assert.ok(d.gems.includes("Fireball 19/0 -> 20/5"));
  assert.ok(d.gems.includes("removed Added Fire Damage Support 20/20"));
  assert.ok(d.gems.includes("new Elemental Focus Support 1/0"));
  assert.ok(d.passives.includes("allocated: Keystone K"));
  assert.ok(d.passives.includes("refunded: Notable A"));
  assert.ok(d.passives.includes("small passives: +1 / -0"));
  assert.ok(d.passives.some((p) => /changed Fire Mastery: \+10% fire -> \+20% fire/.test(p)));
  assert.equal(d.headline.find((h) => h.label === "Weakest max hit").after, 2500);
  assert.match(diffSummary(d), /^level 90->92, DPS \+50\.0%, EHP -10\.0%, 4 items, 3 gems, 3 passives changed$/);
});

test("character_sync: first sync imports into its own build and starts the history", async () => {
  const text = await ok("character_sync", { account: "Sample#0000", character: "sampledeadeye" });
  assert.match(text, /Synced SampleDeadeye \(Standard\): level 92 Ranger \(Deadeye\), main skill Lightning Arrow/);
  assert.doesNotMatch(text, /LEVELLING:/, "no levelling line from level 90 (Stage 7)");
  assert.match(text, /Build "SampleDeadeye - synced" saved to .*SampleDeadeye - synced\.xml/);
  assert.match(text, /3 requests to pathofexile\.com/);
  assert.match(text, /Now: DPS [\d,]+, EHP [\d,]+, weakest max hit [\d,]+/);
  assert.match(text, /First sync: this is the baseline/);
  assert.ok(fs.existsSync(path.join(builds, "SampleDeadeye - synced.xml")));
  assert.equal(site.calls.length, 3);
  assert.ok(site.calls.every((u) => u.startsWith("https://www.pathofexile.com/character-window/")), "only pathofexile.com's public endpoints");
  assert.ok(site.calls[1].includes("accountName=Sample%230000&character=SampleDeadeye&realm=pc"));
  const idx = readIndex();
  assert.equal(idx.last.character, "SampleDeadeye");
  const entry = Object.values(idx.characters)[0];
  assert.equal(entry.timeline.length, 1);
  assert.ok(entry.timeline[0].dps > 0 && entry.timeline[0].ehp > 0);
  // A second request within a minute is refused without touching the site.
  const again = await call("character_sync", {});
  assert.equal(again.isError, true);
  assert.match(again.text, /synced \d+ s ago/);
  assert.equal(site.calls.length, 3);
});

test("character_sync: quality from a matching socket colour is counted once and shown apart", async () => {
  // In the game a gem in a socket of its own colour shows e.g. "Quality: +10%" in its tooltip
  // (3.28+ bonus) though the gem itself has 0%. PoB keeps the gem's own quality and adds the
  // socket's 10% itself; a white socket gives nothing. The build summary shows both parts so
  // nobody adds the 10% again by hand.
  const { tools: all } = createTools();
  const summary = await runTool(all, context, "build_summary", { parts: ["skills"] });
  assert.equal(summary.isError, false, summary.text);
  assert.match(summary.text, /Frenzy 20\/20\+10 socket/, "Frenzy (green gem, green socket): own 20% + 10% socket");
  assert.match(summary.text, /Mirage Archer( Support)? \d+\/3\+10 socket/, "own quality kept as imported (+3%), socket bonus apart");
  assert.match(summary.text, /Frostblink \d+\/0(?!\+)/, "white socket: no socket bonus");
  assert.match(summary.text, /\+N socket = quality from a matching socket colour, already counted/);
});

test("character_sync: second sync lists what changed; character_history shows the timeline", async () => {
  // Age the last entry so the polite one-minute gap has passed.
  const histDir = path.join(tmp, "cache", "history");
  const hFile = fs.readdirSync(histDir).find((f) => f.endsWith(".json") && f !== "index.json");
  const h = JSON.parse(fs.readFileSync(path.join(histDir, hFile), "utf8"));
  h.entries[0].at = new Date(Date.now() - 3600_000).toISOString();
  fs.writeFileSync(path.join(histDir, hFile), JSON.stringify(h));
  // The character changed: level up, one item gone, one gem levelled, a few passives refunded.
  const removedSlot = items.items.find((i) => i.inventoryId === "Helm");
  items = { ...items, character: { ...items.character, level: 93 }, items: items.items.filter((i) => i !== removedSlot) };
  const gemItem = items.items.find((i) => i.inventoryId === "Weapon" && (i.socketedItems ?? []).length);
  const gem = gemItem.socketedItems[0];
  const lvl = gem.properties.find((p) => p.name === "Level");
  const before = parseInt(lvl.values[0][0], 10);
  lvl.values[0][0] = String(before - 1);
  passives = { ...passives, hashes: passives.hashes.slice(0, -3) };
  characters[0] = { ...characters[0], level: 93 };
  // The player switched Grace off in the synced build: the game does not say
  // which auras are on, so the next sync keeps it off instead of turning it on.
  const synced = path.join(builds, "SampleDeadeye - synced.xml");
  const xmlBefore = fs.readFileSync(synced, "utf8");
  const graceOff = xmlBefore.replace(/<Gem\b[^>]*nameSpec="Grace"[^>]*>/, (tag) => tag.replace(/enabled="true"/, 'enabled="false"'));
  assert.notEqual(graceOff, xmlBefore, "the fixture build has Grace");
  fs.writeFileSync(synced, graceOff);

  const text = await ok("character_sync", {}); // names remembered from the first sync
  assert.match(text, /Kept switched off, as in this build before the sync .*: Grace\./);
  assert.match(fs.readFileSync(synced, "utf8"), /<Gem\b[^>]*nameSpec="Grace"[^>]*enabled="false"|<Gem\b[^>]*enabled="false"[^>]*nameSpec="Grace"/);
  assert.match(text, /CHANGES since/);
  assert.match(text, /Level 92 -> 93/);
  assert.match(text, /Helmet: removed /);
  assert.match(text, new RegExp(`${gem.typeLine.replace(/ Support$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ${before}/\\d+ -> ${before - 1}/`));
  assert.match(text, /PASSIVES \([3-9] nodes changed\)\n- refunded: /); // 3 hashes gone; PoB also drops what they connected
  assert.match(text, /(DPS|EHP|Weakest max hit|Life): [\d,]+ -> [\d,]+ \([+-]/);

  const hist = await ok("character_history", {});
  assert.match(hist, /SampleDeadeye \(Standard\), 2 sync\(s\)/);
  assert.match(hist, /\| 92 \| [\d,]+ \|[\s\S]*\| 93 \| [\d,]+ \|.*level 92->93/);
  assert.match(hist, /Since the first sync: level 92->93/);
  assert.equal(Object.values(readIndex().characters)[0].timeline.length, 2);
  const snaps = fs.readdirSync(path.join(histDir, hFile.replace(/\.json$/, "")));
  assert.equal(snaps.length, 2);
});

test("character tools are in the server's tool list", () => {
  const names = createTools().tools.map((t) => t.name);
  assert.ok(names.includes("character"));
});
