// Knowledge engine tests (roadmap Stage 9): no network, no PoB. Run with: npm test
// Every site is replaced by fixtures; the live check against the real sites is `npm run test:kb`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-kb-"));
process.env.POB_AGENT_CACHE = path.join(tmp, "cache");
process.env.POB_AGENT_SETTINGS = path.join(tmp, "AgentEdition.json");
process.env.POB_LIVE = "off";
process.env.POB_KB_GAME = "off";

const { PoliteFetcher, parseRobots, robotsAllows } = await import("../build/knowledge/fetcher.js");
const { parseForumList, parseThread } = await import("../build/knowledge/sources/ggg.js");
const { parsePoedb, poedbSlug } = await import("../build/knowledge/sources/poedb.js");
const { parseVersions, titleFit } = await import("../build/knowledge/sources/poewiki.js");
const { PobData, parseUniqueBlock } = await import("../build/knowledge/sources/pobdata.js");
const { parseAppManifest, parseLibraryFolders } = await import("../build/knowledge/sources/game.js");
const { Versions } = await import("../build/knowledge/versions.js");
const { Knowledge, mentions } = await import("../build/knowledge/engine.js");
const { GLOSSARY } = await import("../build/knowledge/glossary-data.js");
const { findGlossary, glossaryTopic, wikiUrl } = await import("../build/knowledge/glossary.js");
const { citationProblems, compareVersions, majorOf, SOURCES } = await import("../build/knowledge/types.js");
const { keyWords, passagesOf, numbersIn } = await import("../build/knowledge/text.js");
const { knowledgeTools, formatFact, formatLookup } = await import("../build/tools/knowledge.js");

const fixture = (name) => fs.readFileSync(path.join(here, "fixtures", "knowledge", name), "utf8");

// ----- a fake web ---------------------------------------------------------------------------------

const WIKI_ROBOTS = "user-agent: *\nAllow: /\nDisallow: /index.php\nDisallow: /*?search=\nDisallow: /*?*&search=\nDisallow: /*?limit=\nDisallow: /*?*&limit=\nDisallow: /*?section=\nDisallow: /*?*&section=\nDisallow: /*?redirect=\nDisallow: /*?*&redirect=\n";
const GGG_ROBOTS = "user-agent: *\ndisallow: /search/\ndisallow: /api/\ndisallow: /forum/view-post/\n\nuser-agent: bingbot\ncrawl-delay: 10\n";

const VERSIONS = JSON.stringify({ cargoquery: [
  { title: { version: "3.30.0", "release date": "2026-11-13 00:00:00" } },
  { title: { version: "3.29.3d", "release date": "2026-11-10 00:00:00" } },
  { title: { version: "3.29.0", "release date": "2026-07-24 00:00:00" } },
  { title: { version: "3.28.0", "release date": "2026-03-20 00:00:00" } },
] });

const wikiPage = (title, extract, edited) => ({ title, extract, revisions: [{ timestamp: edited }], canonicalurl: `https://www.poewiki.net/wiki/${title.replace(/ /g, "_")}` });
const RESISTANCE = wikiPage("Resistance",
  "Resistance modifies the amount of damage taken from elemental (fire, cold, or lightning) or chaos damage.\n\n\n== Mechanics ==\nResistances have a default maximum of 75%. Maximum resistance can be increased, up to a hard limit of 90%.\nNegative resistances are hard capped at -200%.\n\n\n== Lore ==\nNothing about the question here, only a long line of filler text to rank low.",
  "2026-06-24T13:39:56Z");
const WINTER_ORB = wikiPage("Winter Orb", "Winter Orb is a channelling spell skill.\n\n\n== Skill functions ==\nWinter Orb fires projectiles while channelling and for a duration afterwards.", "2026-11-14T08:00:00Z");
const HYRRI = wikiPage("Hyrri's Ire", "Hyrri's Ire is a unique Zodiac Leather.", "2026-07-19T10:00:00Z");
const OIL = wikiPage("Oil", "An oil is a currency item that can be acquired from Blight encounters.\n\n\n== Mechanics ==\nOils can be applied via Cassia to amulets to anoint a notable passive skill; three oils make one amulet anointment.\nBlighted maps can hold up to three anointments.", "2026-11-14T09:00:00Z");
const AMULET = wikiPage("Amulet", "Amulets are jewellery items worn around the neck.\n\n\n== Item mods ==\nAmulets can roll many different modifiers.", "2026-11-14T09:00:00Z");
const REDIRECTS = { anointing: "Oil", anoint: "Oil" };

function wikiAnswer(url) {
  const u = new URL(url);
  const q = u.searchParams;
  if (q.get("action") === "cargoquery") return VERSIONS;
  const all = [RESISTANCE, WINTER_ORB, HYRRI, OIL, AMULET];
  if (q.get("generator") === "search") return JSON.stringify({ query: { pages: all.filter((p) => keyWords(q.get("gsrsearch")).some((w) => keyWords(p.extract).includes(w))).map((p, i) => ({ ...p, index: i + 1 })) } });
  const titles = (q.get("titles") ?? "").split("|");
  const normalized = [], redirects = [], pages = [];
  for (const t of titles) {
    const to = REDIRECTS[t.toLowerCase()];
    const hit = all.find((p) => p.title.toLowerCase() === (to ?? t).toLowerCase());
    if (hit) { if (to) redirects.push({ from: t, to: hit.title }); else if (hit.title !== t) normalized.push({ from: t, to: hit.title }); if (!pages.includes(hit)) pages.push(hit); }
    else pages.push({ title: t, missing: true });
  }
  return JSON.stringify({ query: { normalized, redirects, pages: pages.map((p) => (q.get("exintro") && p.extract ? { ...p, extract: p.extract.split("\n")[0] } : p)) } });
}

/** A web made of fixtures. `log` records every request; `down` makes hosts fail. */
function fakeWeb({ down = [], overrides = {} } = {}) {
  const log = [];
  const fetch = async (url) => {
    log.push(url);
    const u = new URL(url);
    if (down.includes(u.host)) throw new Error("getaddrinfo ENOTFOUND " + u.host);
    if (overrides[url]) return overrides[url];
    const ok = (body) => ({ status: 200, body });
    if (u.pathname === "/robots.txt") return ok(u.host.includes("wiki") ? WIKI_ROBOTS : u.host.includes("pathofexile") ? GGG_ROBOTS : "User-agent: *\nDisallow: /*/marked\n");
    if (u.host === "www.poewiki.net" || u.host === "www.poe2wiki.net") return ok(wikiAnswer(url));
    if (url === "https://www.pathofexile.com/forum/view-forum/patch-notes") return ok(fixture("forum-list.html"));
    if (url === "https://www.pathofexile.com/forum/view-thread/4013680") return ok(fixture("thread-content-update.html"));
    if (url.startsWith("https://www.pathofexile.com/forum/view-thread/")) return ok(fixture("thread-patch.html"));
    if (url === "https://poedb.tw/us/Hyrris_Ire") return ok(fixture("poedb-item.html"));
    return { status: 404, body: "" };
  };
  return { fetch, log };
}

/** A tiny PoB data folder: one unique with variants, one gem. */
function fakePob() {
  const src = fs.mkdtempSync(path.join(tmp, "pob-")) + "/src";
  fs.mkdirSync(path.join(src, "Data", "Uniques"), { recursive: true });
  fs.mkdirSync(path.join(src, "Data", "Skills"), { recursive: true });
  fs.writeFileSync(path.join(src, "..", "manifest.xml"), `<PoBVersion>\n\t<Version number="2.67.2" />\n</PoBVersion>`);
  fs.writeFileSync(path.join(src, "GameVersions.lua"), `treeVersionList = { "2_6", "3_29_ruthless", "3_29", "3_30_ruthless", "3_30" }\n`);
  fs.writeFileSync(path.join(src, "Data", "Uniques", "body.lua"), `return {\n[[\nHyrri's Ire\nZodiac Leather\nVariant: Pre 3.9.0\nVariant: Current\nImplicits: 0\n+30% chance to Suppress Spell Damage\n+(40-50) to Dexterity\n(140-220)% increased Evasion Rating\n{variant:1}(173-188) to (240-262) Added Cold Damage with Bow Attacks\n{variant:2}(105-145) to (160-200) Added Cold Damage with Bow Attacks\n]],[[\nKintsugi\nExquisite Leather\nLeague: Betrayal\n(100-120)% increased Evasion Rating\n]],\n}\n`);
  fs.writeFileSync(path.join(src, "Data", "Gems.lua"), `return {\n\t["Metadata/Items/Gems/SkillGemWinterOrb"] = {\n\t\tname = "Winter Orb",\n\t\tgrantedEffectId = "FrostFury",\n\t\ttags = {\n\t\t\tintelligence = true,\n\t\t},\n\t\ttagString = "Cold, Spell, Channelling",\n\t\treqStr = 0,\n\t\treqDex = 0,\n\t\treqInt = 100,\n\t\tnaturalMaxLevel = 20,\n\t},\n}\n`);
  // The newest tree as PoB writes it: tab-indented, keys sorted; node groups and masteries are not passives.
  fs.mkdirSync(path.join(src, "TreeData", "3_30"), { recursive: true });
  fs.mkdirSync(path.join(src, "TreeData", "3_29"), { recursive: true });
  fs.writeFileSync(path.join(src, "TreeData", "3_29", "tree.lua"), `return {\n\t["nodes"] = {\n\t\t[42649] = {\n\t\t\t["isNotable"] = true,\n\t\t\t["name"] = "Snowforged",\n\t\t\t["skill"] = 42649,\n\t\t\t["stats"] = {\n\t\t\t\t"an old version",\n\t\t\t},\n\t\t},\n\t},\n}\n`);
  fs.writeFileSync(path.join(src, "TreeData", "3_30", "tree.lua"), [
    "return {", '\t["groups"] = {', "\t\t[702] = {", '\t\t\t["x"] = 1,', "\t\t},", "\t},", '\t["nodes"] = {',
    "\t\t[42649] = {", '\t\t\t["group"] = 702,', '\t\t\t["in"] = {', '\t\t\t\t"6785",', "\t\t\t},", '\t\t\t["isNotable"] = true,', '\t\t\t["name"] = "Snowforged",',
    '\t\t\t["recipe"] = {', '\t\t\t\t"AmberOil",', '\t\t\t\t"TealOil",', '\t\t\t\t"GoldenOil",', "\t\t\t},", '\t\t\t["skill"] = 42649,',
    '\t\t\t["stats"] = {', '\t\t\t\t"25% increased Fire Damage",', '\t\t\t\t"25% increased Cold Damage",', '\t\t\t\t"Enemies Ignited or Chilled by you have -5% to Elemental Resistances",', "\t\t\t},", "\t\t},",
    "\t\t[10661] = {", '\t\t\t["group"] = 702,', '\t\t\t["isKeystone"] = true,', '\t\t\t["name"] = "Iron Reflexes",', '\t\t\t["skill"] = 10661,',
    '\t\t\t["stats"] = {', '\t\t\t\t"Converts all Evasion Rating to Armour.\\', 'Dexterity provides no bonus to Evasion Rating",', "\t\t\t},", "\t\t},",
    "\t\t[1365] = {", '\t\t\t["group"] = 702,', '\t\t\t["isBlighted"] = true,', '\t\t\t["isNotable"] = true,', '\t\t\t["name"] = "Knowledge Barrier",',
    '\t\t\t["recipe"] = {', '\t\t\t\t"PrismaticOil",', '\t\t\t\t"OpalescentOil",', '\t\t\t\t"SilverOil",', "\t\t\t},", '\t\t\t["skill"] = 1365,', '\t\t\t["stats"] = {', '\t\t\t\t"6% increased Energy Shield Recharge Rate",', "\t\t\t},", "\t\t},",
    "\t\t[5000] = {", '\t\t\t["ascendancyName"] = "Elementalist",', '\t\t\t["group"] = 702,', '\t\t\t["isNotable"] = true,', '\t\t\t["name"] = "Shaper of Flames",', '\t\t\t["skill"] = 5000,', '\t\t\t["stats"] = {', '\t\t\t\t"All Damage with Hits can Ignite",', "\t\t\t},", "\t\t},",
    "\t\t[6000] = {", '\t\t\t["group"] = 702,', '\t\t\t["isMastery"] = true,', '\t\t\t["isNotable"] = true,', '\t\t\t["name"] = "Fire Mastery",', '\t\t\t["skill"] = 6000,', "\t\t},",
    "\t},", "}", "",
  ].join("\n"));
  fs.writeFileSync(path.join(src, "Data", "Skills", "act_int.lua"), `skills["FrostFury"] = {\n\tname = "Winter Orb",\n\tdescription = "Channel to conjure an orb above you.",\n\tcastTime = 0.25,\n}\n`);
  return new PobData(src);
}

const NOW = Date.parse("2026-11-15T12:00:00Z");

function engine(webOptions = {}, extra = {}) {
  const web = fakeWeb(webOptions);
  const fetcher = new PoliteFetcher({ fetch: web.fetch, dir: fs.mkdtempSync(path.join(tmp, "http-")), sleep: async () => {}, now: () => NOW, maxRequestsPerCall: 20, ...extra.fetcher });
  const kb = new Knowledge({ fetcher, pob: extra.pob ?? fakePob(), now: () => NOW, game: () => extra.game ?? null });
  return { kb, web, fetcher };
}

const allCited = (facts) => { for (const f of facts) assert.deepEqual(citationProblems(f), [], `uncited fact: ${JSON.stringify(f)}`); };

// ----- polite fetching ----------------------------------------------------------------------------

test("robots.txt: our rules are the '*' group, longest match wins, wildcards work", () => {
  const wiki = parseRobots(WIKI_ROBOTS);
  assert.equal(robotsAllows(wiki, "/w/api.php?action=query&generator=search&gsrsearch=x&gsrlimit=5&exlimit=5&redirects=1"), true);
  assert.equal(robotsAllows(wiki, "/w/api.php?action=query&list=search&search=x"), false);
  assert.equal(robotsAllows(wiki, "/w/api.php?action=cargoquery&tables=versions&limit=5"), false);
  assert.equal(robotsAllows(wiki, "/index.php?title=Resistance"), false);
  const ggg = parseRobots(GGG_ROBOTS);
  assert.equal(robotsAllows(ggg, "/forum/view-thread/4013680"), true);
  assert.equal(robotsAllows(ggg, "/api/trade/data/stats"), false);
  assert.equal(robotsAllows(ggg, "/forum/view-post/123"), false);
  assert.deepEqual(parseRobots("User-agent: pob-agent-edition\nDisallow: /\n\nUser-agent: *\nAllow: /"), { allow: [], disallow: ["/"] }, "a group naming us overrides '*'");
  assert.equal(robotsAllows(parseRobots(""), "/anything"), true);
});

test("fetcher: a disallowed URL is never requested", async () => {
  const web = fakeWeb();
  const fetcher = new PoliteFetcher({ fetch: web.fetch, dir: fs.mkdtempSync(path.join(tmp, "http-")), sleep: async () => {} });
  await assert.rejects(fetcher.get("https://www.pathofexile.com/api/trade/data/stats", { ttlMs: 1000 }), /robots\.txt/);
  assert.deepEqual(web.log, ["https://www.pathofexile.com/robots.txt"]);
});

test("fetcher: caches, paces per site, caps requests per call, and never retries a site that asked for a pause", async () => {
  const web = fakeWeb();
  const sleeps = [];
  let now = 1_000_000;
  const fetcher = new PoliteFetcher({ fetch: web.fetch, dir: fs.mkdtempSync(path.join(tmp, "http-")), sleep: async (ms) => { sleeps.push(ms); now += ms; }, now: () => now, minIntervalMs: 1500, maxRequestsPerCall: 2 });
  const url = "https://www.pathofexile.com/forum/view-forum/patch-notes";
  const first = await fetcher.get(url, { ttlMs: 60_000 });
  assert.equal(first.fromCache, false);
  assert.ok(sleeps.some((ms) => ms >= 1500), "no pause between robots.txt and the page on the same site");
  const again = await fetcher.get(url, { ttlMs: 60_000 });
  assert.equal(again.fromCache, true);
  assert.equal(web.log.filter((u) => u === url).length, 1, "the cached page was requested again");
  // A different tag (game version) makes the cached copy count as old.
  await fetcher.get(url, { ttlMs: 60_000, tag: "3.30.0" });
  assert.equal(web.log.filter((u) => u === url).length, 2);
  await assert.rejects(fetcher.get("https://www.pathofexile.com/forum/view-thread/1", { ttlMs: 1 }), /Request limit/);
  fetcher.beginCall();
  assert.equal(await fetcher.get("https://www.pathofexile.com/forum/does-not-exist", { ttlMs: 1, allow404: true }), null);

  const busy = fakeWeb({ overrides: { "https://poedb.tw/us/Busy": { status: 429, body: "", retryAfter: "120" } } });
  const polite = new PoliteFetcher({ fetch: busy.fetch, dir: fs.mkdtempSync(path.join(tmp, "http-")), sleep: async () => {}, now: () => now });
  await assert.rejects(polite.get("https://poedb.tw/us/Busy", { ttlMs: 1 }), /pause/);
  await assert.rejects(polite.get("https://poedb.tw/us/Other", { ttlMs: 1 }), /asked for a pause/);
  assert.equal(busy.log.filter((u) => u.includes("/us/")).length, 1, "the site was contacted again during its pause");
});

test("fetcher: offline mode and unreachable sites fall back to the cache and say so", async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "http-"));
  const web = fakeWeb();
  const url = "https://www.pathofexile.com/forum/view-forum/patch-notes";
  await new PoliteFetcher({ fetch: web.fetch, dir, sleep: async () => {}, now: () => NOW }).get(url, { ttlMs: 1000 });
  const dead = fakeWeb({ down: ["www.pathofexile.com"] });
  const later = new PoliteFetcher({ fetch: dead.fetch, dir, sleep: async () => {}, now: () => NOW + 10 * 24 * 3600_000 });
  const page = await later.get(url, { ttlMs: 1000 });
  assert.equal(page.stale, true);
  const offline = new PoliteFetcher({ fetch: async () => { throw new Error("must not be called"); }, dir, offline: true });
  assert.equal((await offline.get(url, { ttlMs: 1 })).fromCache, true);
  await assert.rejects(offline.get("https://www.pathofexile.com/forum/view-thread/9", { ttlMs: 1 }), /Offline/);
});

// ----- parsers (a site changing its layout must fail here, not produce wrong facts) -----------------

test("GGG forum list: versions from thread titles, PoE1 only", () => {
  const threads = parseForumList(fixture("forum-list.html"));
  assert.deepEqual(threads.map((t) => t.version), ["3.30.0", "3.29.3d", "3.29.3c"]);
  assert.equal(threads[0].contentUpdate, true);
  assert.equal(threads[0].url, "https://www.pathofexile.com/forum/view-thread/4013680");
  assert.equal(threads[1].contentUpdate, false);
  assert.throws(() => parseForumList("<html>maintenance</html>"), /layout/);
});

test("GGG thread: only the staff post is read, with sections, sub-points and the post date", () => {
  const { lines, posted_at } = parseThread(fixture("thread-content-update.html"));
  assert.equal(posted_at, "2026-11-11T05:10:59.000Z");
  const text = JSON.stringify(lines);
  assert.ok(!/9999|deleted from the game|Return to top|Table of Contents/i.test(text), "player replies or page furniture leaked into the notes");
  const orb = lines.find((l) => l.text.startsWith("Winter Orb:"));
  assert.equal(orb.section, "Skill Gem Changes");
  const sub = lines.find((l) => l.text.startsWith("If Bismuth Flask"));
  assert.equal(sub.section, "Ascendancy Changes");
  assert.match(sub.parent, /^The Pathfinder's Master Distiller/);
  assert.equal(lines.find((l) => l.text.startsWith("The Pathfinder's Master Surgeon")).parent, undefined);
  const plain = parseThread(fixture("thread-patch.html"));
  assert.equal(plain.lines.length, 1);
  assert.match(plain.lines[0].text, /^This is the end of the Allflame League/);
  assert.equal(plain.posted_at, "2026-11-11T05:00:00.000Z");
  assert.throws(() => parseThread("<html><body>Forum is down</body></html>"), /layout/);
});

test("poedb: item box lines, mod lines without reminder text, version history", () => {
  const p = parsePoedb(fixture("poedb-item.html"));
  assert.equal(p.title, "Hyrri's Ire");
  assert.deepEqual(p.itemLines.slice(0, 5), ["Hyrri's Ire", "Zodiac Leather", "Body Armours", "Evasion Rating: (2459-3770)", "Requires Level 65, 197 Dex"]);
  assert.deepEqual(p.modLines, ["+30% chance to Suppress Spell Damage", "+(40-50) to Dexterity", "(150-220)% increased Evasion Rating"]);
  assert.ok(!p.itemLines.includes("not part of the item box"));
  assert.deepEqual(p.history.map((h) => h.version), ["3.16.0", "3.9.0", "3.9.0"]);
  assert.match(p.history[0].text, /^Hyrri's Ire: Now grants 30% chance/);
  assert.equal(poedbSlug("Hyrri's Ire"), "Hyrris_Ire");
  assert.deepEqual(parsePoedb("<html><title>Whatever - PoEDB</title></html>"), { title: "Whatever", itemLines: [], modLines: [], history: [] });
});

test("wiki: versions table, title fit", () => {
  assert.deepEqual(parseVersions(VERSIONS)[0], { version: "3.30.0", released: "2026-11-13" });
  assert.throws(() => parseVersions(JSON.stringify({ cargoquery: [] })), /empty/);
  assert.throws(() => parseVersions("<html>error</html>"), /not JSON/);
  assert.equal(titleFit("resistance cap", "Resistance"), 0.5);
  assert.equal(titleFit("Spell Suppression", "Spell suppression"), 1);
  assert.equal(titleFit("resistance cap", "Melding of the Flesh"), 0);
});

test("PoB data: current variant of a unique, gems with description, version", () => {
  const block = "Bramblejack\nPlate Vest\nVariant: Pre 3.19.0\nVariant: Current\nImplicits: 0\n{variant:1}+(12-20) to maximum Life\n{variant:2}+(30-60) to maximum Life\n{tags:life}{variant:2}1000% of Melee Physical Damage taken reflected to Attacker";
  const u = parseUniqueBlock(block, "Data/Uniques/body.lua");
  assert.deepEqual(u.mods, ["+(30-60) to maximum Life", "1000% of Melee Physical Damage taken reflected to Attacker"]);
  assert.deepEqual(u.oldVariants, ["Pre 3.19.0"]);
  const pob = fakePob();
  assert.deepEqual(pob.version(), { pob: "2.67.2", game: "3.30" });
  assert.equal(pob.unique("hyrri's ire")[0].mods.length, 4);
  assert.equal(pob.gem("winter orb").description, "Channel to conjure an orb above you.");
  assert.deepEqual(pob.namesIn("is Winter Orb good with Hyrri's Ire?"), ["hyrri's ire", "winter orb"]);
  assert.match(pob.url("Data/Gems.lua"), /^https:\/\/github\.com\/PathOfBuildingCommunity\/PathOfBuilding\/blob\/v2\.67\.2\/src\/Data\/Gems\.lua$/);
});

test("PoB data: notables and keystones of the newest tree, with stats and the anoint recipe", () => {
  const pob = fakePob();
  const [snow] = pob.passive("snowforged");
  assert.deepEqual(snow.stats, ["25% increased Fire Damage", "25% increased Cold Damage", "Enemies Ignited or Chilled by you have -5% to Elemental Resistances"], "read from the 3.30 tree, not the 3.29 one");
  assert.deepEqual(snow.recipe, ["Amber Oil", "Teal Oil", "Golden Oil"]);
  assert.equal(snow.file, "TreeData/3_30/tree.lua");
  assert.equal(snow.offTree, false);
  const [iron] = pob.passive("Iron Reflexes");
  assert.equal(iron.kind, "keystone");
  assert.deepEqual(iron.stats, ["Converts all Evasion Rating to Armour. Dexterity provides no bonus to Evasion Rating"], "a string continued on the next line is one stat");
  assert.equal(pob.passive("Knowledge Barrier")[0].anointOnly, true);
  assert.equal(pob.passive("Shaper of Flames")[0].ascendancy, "Elementalist");
  assert.deepEqual(pob.passive("Fire Mastery"), [], "masteries are not notables");
  assert.deepEqual(pob.namesIn("is Snowforged better than Iron Reflexes?"), ["iron reflexes", "snowforged"]);
});

test("lookup of a notable: PoB's stats and oil recipe, cited; unknown names say what was searched", async () => {
  const { kb } = engine();
  const r = await kb.lookup("Snowforged", { source: "pob" });
  allCited(r.facts);
  assert.equal(r.facts.length, 1);
  const [f] = r.facts;
  assert.equal(f.kind, "passive");
  assert.equal(f.title, "Snowforged (PoB 2.67.2, tree 3.30)");
  assert.match(f.text, /^Snowforged: passive tree notable; 25% increased Fire Damage; .*amulet anoint recipe: Amber Oil \+ Teal Oil \+ Golden Oil$/);
  assert.match(f.url, /\/blob\/v2\.67\.2\/src\/TreeData\/3_30\/tree\.lua$/);
  const anointOnly = await kb.lookup("Knowledge Barrier", { source: "pob" });
  assert.match(anointOnly.facts[0].text, /only available as an anointment \(not on the passive tree\).*Prismatic Oil \+ Opalescent Oil \+ Silver Oil/);
  const keystone = await kb.lookup("iron reflexes", { source: "pob" });
  assert.match(keystone.facts[0].text, /^Iron Reflexes: passive tree keystone; Converts all Evasion Rating to Armour/);
  assert.doesNotMatch(keystone.facts[0].text, /anoint/, "keystones are not anointed");
  const none = await kb.lookup("Not A Real Node", { source: "pob" });
  assert.equal(none.facts.length, 0);
  assert.match(none.notes.join(" "), /no unique, gem, notable or keystone named "Not A Real Node"/);
});

test("wiki: a question about anointing reaches the Oil page, a plain 'amulet' question does not", async () => {
  assert.equal(glossaryTopic("anoint amulet oils how")?.page, "Oil");
  assert.equal(glossaryTopic("how do I anoint my amulet?")?.page, "Oil");
  assert.equal(glossaryTopic("chaos inoculation"), undefined, "only entries marked as topics");
  const { kb } = engine();
  for (const q of ["anoint amulet oils how", "how do I anoint my amulet", "anointing an amulet"]) {
    const r = await kb.lookup(q);
    allCited(r.facts);
    const wiki = r.facts.filter((f) => f.source === "poewiki" && f.kind === "page");
    assert.equal(wiki[0]?.url, "https://www.poewiki.net/wiki/Oil", `${q}: ${wiki.map((f) => f.title)}`);
    assert.ok(wiki.some((f) => /three oils make one amulet anointment/.test(f.text)), `${q}: the passage on anointing amulets`);
    assert.ok(!wiki.some((f) => f.flags?.some((x) => /does not match/.test(x))), `${q}: not a weak hit`);
    assert.ok(r.facts.some((f) => f.kind === "glossary" && /Anoint/.test(f.title)), `${q}: the glossary summary`);
  }
  const amulet = await kb.lookup("amulet", { source: "wiki" });
  assert.equal(amulet.facts[0].url, "https://www.poewiki.net/wiki/Amulet");
});

test("installed game: Steam manifest and library list are read, nothing else", () => {
  assert.deepEqual(parseAppManifest('"AppState"\n{\n\t"appid"\t\t"238960"\n\t"LastUpdated"\t\t"1794375038"\n\t"buildid"\t\t"26554937"\n}'), { build: "26554937", updated_at: new Date(1794375038000).toISOString() });
  assert.deepEqual(parseLibraryFolders('"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"E:\\\\SteamLibrary"\n\t}\n}'), ["C:\\Steam", "E:\\SteamLibrary"]);
});

test("versions and text helpers", () => {
  assert.ok(compareVersions("3.30.0", "3.29.3d") > 0);
  assert.ok(compareVersions("3.29.3d", "3.29.3c") > 0);
  assert.equal(majorOf("3.29.3d"), "3.29");
  const known = parseVersions(VERSIONS);
  assert.equal(Versions.at(known, "2026-07-20T14:02:41Z"), "3.28.0");
  assert.equal(Versions.at(known, "2026-11-14T00:00:00Z"), "3.30.0");
  assert.equal(Versions.at(known, "2020-01-01T00:00:00Z"), undefined);
  assert.deepEqual(keyWords("What are the Resistances caps?"), ["resistanc", "cap"]);
  assert.deepEqual(keyWords("capped increased stunned resistances"), keyWords("cap increase stun resistance"));
  assert.deepEqual(passagesOf("Intro.\n\n== A ==\nText a.\n=== B ===\nText b."), [{ heading: "", text: "Intro." }, { heading: "A", text: "Text a." }, { heading: "B", text: "Text b." }]);
  assert.deepEqual(numbersIn("75% up to 90%, or 1.5 seconds"), ["75", "90", "1.5"]);
});

// ----- the engine ---------------------------------------------------------------------------------

test("current version: official thread as the source, announced versions are not 'live'", async () => {
  const { kb } = engine();
  const v = await kb.versions.info();
  assert.equal(v.current.version, "3.30.0");
  assert.equal(v.current.released, "2026-11-13");
  assert.equal(v.fact.source, "ggg");
  allCited([v.fact]);
  // Two days before the release the content update thread exists, but 3.29.3d is what is live.
  const web = fakeWeb();
  const before = Date.parse("2026-11-11T12:00:00Z");
  const early = new Knowledge({ fetcher: new PoliteFetcher({ fetch: web.fetch, dir: fs.mkdtempSync(path.join(tmp, "http-")), sleep: async () => {}, now: () => before }), pob: fakePob(), now: () => before, game: () => null });
  const e = await early.versions.info();
  assert.equal(e.current.version, "3.29.3d");
  assert.equal(e.announced.version, "3.30.0");
  const patch = await early.patch({});
  assert.equal(patch.scope, "3.29");
  assert.ok(patch.notes.some((n) => /announced 3\.30\.0/.test(n)));
});

test("freshness: a game patched after the version data was read forces a re-check", async () => {
  const { kb, web } = engine({}, { game: { client: "steam", build: "1", updated_at: new Date(NOW + 3600_000).toISOString() } });
  const v = await kb.versions.info();
  assert.ok(v.notes.some((n) => /re-checked/.test(n)));
  assert.equal(web.log.filter((u) => u.endsWith("/forum/view-forum/patch-notes")).length, 2);
});

test("no site reachable: PoB's version is assumed and flagged, never presented as verified", async () => {
  const { kb } = engine({ down: ["www.poewiki.net", "www.pathofexile.com", "poedb.tw"] });
  const r = await kb.lookup("Hyrri's Ire");
  assert.equal(r.version.current.version, "3.30.0");
  assert.match(r.version.fact.flags.join(" "), /not verified/);
  assert.ok(r.notes.some((n) => /No site could be reached/.test(n)));
  assert.ok(r.facts.some((f) => f.source === "pob"), "PoB's local data should still answer");
  allCited(r.facts);
});

test("lookup: every fact is cited, ordered by source rank, outdated wiki text is flagged", async () => {
  const { kb } = engine();
  const r = await kb.lookup("resistance cap");
  allCited(r.facts);
  assert.ok(r.facts.length >= 2);
  const wiki = r.facts.filter((f) => f.source === "poewiki" && f.kind === "page");
  assert.equal(wiki[0].title, "Resistance");
  assert.equal(wiki[0].url, "https://www.poewiki.net/wiki/Resistance");
  assert.equal(wiki[0].game_version, "3.28.0", "the version that was live when the page was last edited");
  assert.match(wiki[0].flags.join(" "), /before 3\.30 was released \(2026-11-13\): may be outdated/);
  assert.ok(!wiki.some((f) => /Lore/.test(f.title)), "an unrelated passage was returned");
  // "Resistance" is a common word: a line that only mentions it in passing is not a patch change to it.
  assert.ok(!r.facts.some((f) => f.source === "ggg"), "a passing mention was reported as a change");
  const ranks = r.facts.map((f) => SOURCES[f.source].rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test("lookup of a unique: PoB, poedb and wiki side by side, and their disagreement is reported", async () => {
  const { kb } = engine();
  const r = await kb.lookup("Hyrri's Ire");
  allCited(r.facts);
  assert.deepEqual([...new Set(r.facts.map((f) => f.source))], ["pob", "poedb", "poewiki"]);
  const pob = r.facts.find((f) => f.source === "pob");
  assert.match(pob.text, /\(105-145\) to \(160-200\) Added Cold Damage with Bow Attacks/);
  assert.ok(!/173-188/.test(pob.text), "an old variant's mod was shown as current");
  assert.equal(pob.game_version, "3.30");
  assert.match(pob.url, /Data\/Uniques\/body\.lua$/);
  const history = r.facts.find((f) => f.kind === "history");
  assert.equal(history.game_version, "3.16.0");
  const note = r.notes.find((n) => /SOURCES DISAGREE/.test(n));
  assert.ok(note, "PoB says 140-220, poedb says 150-220: that must be reported");
  assert.match(note, /only in PoB: "\(140-220\)% increased Evasion Rating"/);
  assert.match(note, /only on poedb: "\(150-220\)% increased Evasion Rating"/);
  assert.ok(!/Suppressed Hits and Ailments/.test(note), "reminder text is not a disagreement");
});

test("lookup of a gem: the official patch note about it comes first", async () => {
  const { kb } = engine();
  const r = await kb.lookup("Winter Orb");
  allCited(r.facts);
  assert.equal(r.facts[0].source, "ggg");
  assert.match(r.facts[0].text, /^Winter Orb: Now fires 2 Projectiles/);
  assert.equal(r.facts[0].game_version, "3.30.0");
  assert.equal(r.facts[0].url, "https://www.pathofexile.com/forum/view-thread/4013680");
  assert.ok(r.notes.some((n) => /patch notes mention Winter Orb/.test(n)));
  const wiki = r.facts.find((f) => f.source === "poewiki");
  assert.ok(!wiki.flags, "a page edited after the release is not outdated");
  assert.equal(wiki.game_version, "3.30.0");
});

test("lookup: nothing found means no facts, not an invented answer; PoE2 is separate and labelled", async () => {
  const { kb } = engine();
  const none = await kb.lookup("Zzyzx Flibbertigibbet");
  assert.deepEqual(none.facts, []);
  assert.match(formatLookup("Zzyzx Flibbertigibbet", none), /No source found.*Do not answer from memory/s);
  const poe2 = await kb.lookup("Resistance", { source: "poe2" });
  assert.ok(poe2.facts.length > 0);
  for (const f of poe2.facts) { assert.equal(f.game, "poe2"); assert.equal(f.source, "poe2wiki"); }
  assert.match(formatFact(poe2.facts[0], 1), /PATH OF EXILE 2/);
  await assert.rejects(kb.lookup("  "), /Give a topic/);
});

test("verify: supported, contradicted and not found, each with its evidence", async () => {
  const { kb } = engine();
  const yes = await kb.verify("Resistance", "The default maximum resistance is 75%");
  assert.equal(yes.verdict, "supported");
  assert.equal(yes.evidence[0].text, "Resistances have a default maximum of 75%.");
  allCited(yes.evidence);
  const no = await kb.verify("Resistance", "The default maximum resistance is 80%");
  assert.equal(no.verdict, "contradicted");
  assert.match(no.reason, /75/);
  const unknown = await kb.verify("Resistance", "Resistance also grants movement speed to minions");
  assert.equal(unknown.verdict, "not found");
  assert.match(unknown.reason, /unverified/);
});

test("patch notes: by text, by names from a build, and what was not named", async () => {
  const { kb } = engine();
  const all = await kb.patch({});
  assert.equal(all.scope, "3.30");
  assert.equal(all.threads.length, 1);
  assert.equal(all.facts.length, 7);
  allCited(all.facts);
  const flasks = await kb.patch({ filter: "Bismuth Flask" });
  assert.equal(flasks.facts.length, 1);
  assert.match(flasks.facts[0].text, /^The Pathfinder's Master Distiller .* > If Bismuth Flask Charges/);
  const mine = await kb.patch({ names: ["Winter Orb", "Hyrri's Ire", "Pathfinder", "Elemental Overload"] });
  assert.deepEqual(mine.unmatched, ["Hyrri's Ire", "Elemental Overload"]);
  assert.equal(mine.facts.filter((f) => /\[Winter Orb\]/.test(f.title)).length, 1);
  assert.equal(mine.facts.filter((f) => /\[Pathfinder\]/.test(f.title)).length, 4, "sub-points of a line about the ascendancy belong to it");
  const one = await kb.patch({ version: "3.29.3d" });
  assert.equal(one.facts.length, 1);
  assert.equal(one.facts[0].game_version, "3.29.3d");
  await assert.rejects(kb.patch({ version: "latest" }), /not a game version/);
  await assert.rejects(kb.patch({ version: "3.11" }), /No patch-notes thread for 3\.11/);
});

// ----- tools and glossary ---------------------------------------------------------------------------

test("tools: output carries source, link, version and date for every fact, and the rules", async () => {
  const { kb } = engine();
  const [lookup, patch] = knowledgeTools(kb);
  const text = await lookup.run({}, { query: "Hyrri's Ire" });
  const blocks = text.split(/\n(?=\[\d+\] )/).slice(1);
  assert.ok(blocks.length >= 3);
  for (const block of blocks) {
    assert.match(block, /\| (pob|poedb|poewiki|ggg|game) \(/, block);
    assert.match(block, /\| PoE1 \d+\.\d+/, block);
    assert.match(block, /\| read \d{4}-\d{2}-\d{2}/, block);
    assert.match(block, /\n    https:\/\//, block);
  }
  assert.match(text, /^Live Path of Exile 1 version: 3\.30\.0 \(released 2026-11-13\) \[ggg: https:\/\/www\.pathofexile\.com\/forum\/view-thread\/4013680/);
  assert.match(text, /Anything not listed here is unverified/);
  const claim = await lookup.run({}, { query: "Resistance", claim: "Resistances have a hard limit of 90%" });
  assert.match(claim, /Verdict: SUPPORTED/);
  const notes = await patch.run({}, { filter: "Winter Orb" });
  assert.match(notes, /Source: ggg .* \| PoE1 3\.30\.0 \| posted 2026-11-11/);
  assert.match(notes, /https:\/\/www\.pathofexile\.com\/forum\/view-thread\/4013680/);
  assert.match(notes, /- \[Skill Gem Changes\] "Winter Orb: Now fires 2 Projectiles/);
  // A fact that cannot be cited is never printed as a fact.
  assert.match(formatFact({ source: "poewiki", title: "X", text: "claim", url: "", game: "poe1", game_version: "3.30.0", retrieved_at: "2026-11-13T00:00:00Z" }, 1), /dropped/);
  assert.ok(!formatFact({ source: "poewiki", title: "X", text: "claim", url: "", game: "poe1", game_version: "3.30.0", retrieved_at: "2026-11-13T00:00:00Z" }, 1).includes('"claim"'));
});

test("glossary: every entry is sourced, quoted briefly, dated and versioned", () => {
  assert.ok(GLOSSARY.length >= 40, `only ${GLOSSARY.length} glossary entries`);
  const seen = new Map();
  for (const e of GLOSSARY) {
    for (const name of [e.term, ...(e.aliases ?? [])]) {
      const key = keyWords(name).join(" ");
      assert.ok(key, `${e.term}: empty name`);
      assert.ok(!seen.has(key) || seen.get(key) === e.term, `"${name}" is used by two glossary entries (${seen.get(key)} and ${e.term})`);
      seen.set(key, e.term);
    }
    for (const [label, side] of [["poe1", e], ...(e.poe2 ? [["poe2", e.poe2]] : [])]) {
      assert.ok(side.text.length >= 20 && side.text.length <= 520, `${e.term} (${label}): summary length ${side.text.length}`);
      assert.ok(side.page, `${e.term} (${label}): no source page`);
      const words = side.quote.split(/\s+/).length;
      assert.ok(words >= 3 && words <= 40, `${e.term} (${label}): the quote must be short (${words} words)`);
      assert.match(wikiUrl(side.page, label === "poe2"), label === "poe2" ? /^https:\/\/www\.poe2wiki\.net\/wiki\/\S+$/ : /^https:\/\/www\.poewiki\.net\/wiki\/\S+$/);
    }
    assert.match(e.checked, /^\d{4}-\d{2}-\d{2}T/, `${e.term}: checked date`);
    assert.match(e.version, /^\d+\.\d+\.\d+/, `${e.term}: version`);
    if (e.poe2) assert.match(e.poe2.version, /^\d+\.\d+\.\d+/, `${e.term}: PoE2 version`);
  }
  assert.equal(findGlossary("what is spell suppression?")?.term, "Spell Suppression");
  assert.equal(findGlossary("a word nobody uses"), undefined);
});

test("glossary in lookup: summary with its quote first, PoE2 comparison labelled, old entries flagged", async () => {
  const { kb } = engine();
  const r = await kb.lookup("resistance cap", { source: "glossary" });
  allCited(r.facts);
  assert.equal(r.facts[0].kind, "glossary");
  assert.ok(r.facts[0].quote);
  const poe2 = r.facts.find((f) => f.game === "poe2");
  if (poe2) assert.equal(poe2.source, "poe2wiki");
  const entry = { term: "Test Term", text: "x".repeat(50), quote: "a short quote", page: "Test", checked: "2026-01-01T00:00:00Z", version: "3.27.0" };
  const fact = kb.glossaryFact(entry, r.version, false);
  assert.match(fact.flags.join(" "), /checked for 3\.27\.0; the game is now 3\.30\.0/);
});

// ----- through the real tool registry and the headless PoB engine ------------------------------------

test("registered tools: kb_lookup answers from PoB's own data with no network at all", async () => {
  const { createTools, runTool } = await import("../build/server.js");
  const { tools, context } = createTools();
  assert.deepEqual(tools.map((t) => t.name).filter((n) => n.startsWith("kb_")), ["kb_lookup", "kb_patch"]);
  process.env.POB_KB_OFFLINE = "1";
  try {
    const r = await runTool(tools, context, "kb_lookup", { query: "Hyrri's Ire", source: "pob" });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /Hyrri's Ire \(PoB [\d.]+\) \| pob \(Path of Building data; rank 3\) \| PoE1 \d+\.\d+/);
    assert.match(r.text, /https:\/\/github\.com\/PathOfBuildingCommunity\/PathOfBuilding\/blob\/v[\d.]+\/src\/Data\/Uniques\/body\.lua/);
    assert.match(r.text, /chance to Suppress Spell Damage/);
    // A notable the optimiser suggests as an anoint, from PoB's real tree data.
    const notable = await runTool(tools, context, "kb_lookup", { query: "Divine Judgement", source: "pob" });
    assert.equal(notable.isError, false, notable.text);
    assert.match(notable.text, /Divine Judgement: passive tree notable; .*Elemental Damage; amulet anoint recipe: \w+ Oil \+ \w+ Oil \+ \w+ Oil/);
    assert.match(notable.text, /src\/TreeData\/\d+_\d+\/tree\.lua/);
    assert.match(r.text, /No site could be reached: assuming the version PoB's data is for/);
    const bad = await runTool(tools, context, "kb_patch", { version: "soon" });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /not a game version/);
  } finally {
    delete process.env.POB_KB_OFFLINE;
    context.pob.close();
  }
});

test("kb_patch { build: true }: names come from the open build in PoB, lines from the official notes", async () => {
  const builds = path.join(tmp, "Builds");
  fs.mkdirSync(builds, { recursive: true });
  fs.copyFileSync(path.join(here, "fixtures", "occ-vortex.xml"), path.join(builds, "occ-vortex.xml"));
  process.env.POB_DIRECTORY = builds;
  process.env.POB_AGENT_UPDATE_CHECK = "off";
  const { createTools, runTool } = await import("../build/server.js");
  const { tools, context } = createTools();
  try {
    const opened = await runTool(tools, context, "open_build", { name: "occ-vortex" });
    assert.equal(opened.isError, false, opened.text);
    // The fixture build uses Vortex; give the fake notes one line about it (test-only wording).
    const thread = "https://www.pathofexile.com/forum/view-thread/4013680";
    const body = fixture("thread-content-update.html").replace("<li>Summon Stone Golem", "<li>Vortex: test-only line for the build check.</li>\n<li>Summon Stone Golem");
    const { kb } = engine({ overrides: { [thread]: { status: 200, body } } });
    const [, patch] = knowledgeTools(kb);
    const text = await patch.run(context, { build: true });
    assert.match(text, /^Checked \d+ names from .*occ-vortex/);
    assert.match(text, /1 line naming something in .*occ-vortex.* in the official 3\.30 patch notes/);
    assert.match(text, /Source: ggg .*\| PoE1 3\.30\.0 \| posted 2026-11-11/);
    assert.match(text, /- \[Skill Gem Changes \[Vortex\]\] "Vortex: test-only line for the build check\."/);
    assert.ok(!/Winter Orb: Now fires/.test(text), "a gem the build does not use was reported");
    const notNamed = /Not named in these notes: (.*)/.exec(text)?.[1] ?? "";
    assert.match(notNamed, /unique items: Heretic's Veil; ascendancy: Occultist; \d+ keystones and notables\./);
    assert.ok(!/gems: [^;]*\bVortex\b/.test(notNamed), "Vortex was found, so it must not be listed as not named");
    assert.match(text, /General changes .* can affect a build without naming/);
  } finally {
    context.pob.close();
  }
});

test("build names in patch notes: exact names only, no look-alikes, Ruthless kept apart", async () => {
  const line = (text, section = "Skill Gem Changes", parent) => ({ section, text, ...(parent ? { parent } : {}) });
  const gem = (name) => ({ name, kind: "gem" });
  const passive = (name) => ({ name, kind: "passive" });
  // A support gem's name is also an everyday stat: only the capitalised name counts.
  assert.equal(mentions(line("Summon Flame Golem: Golems now grant 15% increased Area of Effect (previously 20%)."), gem("Increased Area of Effect")), false);
  assert.equal(mentions(line("Increased Area of Effect Support: now has a lower cost."), gem("Increased Area of Effect")), true);
  assert.equal(mentions(line("Decreased the efficacy of player Item Rarity."), gem("Efficacy")), false);
  assert.equal(mentions(line("Winter Orb: Now fires 2 Projectiles."), gem("Winter Orb")), true);
  // A name that is a piece of a longer name is a different thing.
  assert.equal(mentions(line("The Elementalist's Shaper of Flames Notable Passive Skill now grants Hits always Ignite.", "Ascendancy Changes"), passive("Shaper")), false);
  assert.equal(mentions(line("Added a new Essence, Essence of Trickery.", "Endgame Changes"), passive("Trickery")), false);
  assert.equal(mentions(line("Fixed a bug with uniques dropped by Velka, the Tide Witch.", "Bug Fixes"), { name: "Witch", kind: "ascendancy" }), false);
  // Passives: only in a line about passives, never the Atlas tree; sub-points belong to their parent line.
  assert.equal(mentions(line("The Pathfinder's Master Surgeon Notable Passive Skill now has 50% less Life Flask Recovery Rate.", "Ascendancy Changes"), passive("Master Surgeon")), true);
  assert.equal(mentions(line("Master Surgeon now grants more map drops.", "Atlas Passive Tree Changes"), passive("Master Surgeon")), false);
  assert.equal(mentions(line("If Bismuth Flask Charges are consumed, Penetrate 30% Elemental Resistances.", "Ascendancy Changes", "The Pathfinder's Master Distiller Notable Passive Skill now grants bonuses:"), passive("Master Distiller")), true);
  assert.equal(mentions(line("The Occultist's Void Beacon Notable Passive Skill now grants more.", "Ascendancy Changes"), { name: "Occultist", kind: "ascendancy" }), true);
  assert.equal(mentions(line("Hyrri's Ire: Now grants 30% chance to Suppress Spell Damage.", "Unique Item Changes"), { name: "Hyrri's Ire", kind: "unique" }), true);

  const thread = "https://www.pathofexile.com/forum/view-thread/4013680";
  const body = fixture("thread-content-update.html").replace("<h3>Skill Gem Changes</h3>", "<h3>Ruthless-specific Changes</h3><ul><li>The Pathfinder's Nature's Boon Notable Passive Skill now grants more (test-only line).</li></ul><h3>Skill Gem Changes</h3>");
  const { kb } = engine({ overrides: { [thread]: { status: 200, body } } });
  const r = await kb.patch({ build: [{ name: "Pathfinder", kind: "ascendancy" }, gem("Winter Orb"), gem("Increased Area of Effect"), passive("Elemental Overload")] });
  allCited(r.facts);
  assert.equal(r.facts.filter((f) => /\[Pathfinder\]/.test(f.title)).length, 4);
  assert.equal(r.facts.filter((f) => /\[Winter Orb\]/.test(f.title)).length, 1);
  assert.ok(!r.facts.some((f) => /Nature's Boon/.test(f.text)), "a Ruthless-only line was reported as a change to the build");
  assert.ok(r.notes.some((n) => /1 more line in the Ruthless-specific section/.test(n)));
  assert.deepEqual(r.unmatched, ["Increased Area of Effect", "Elemental Overload"]);
});
