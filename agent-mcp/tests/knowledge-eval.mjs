// Live check of the knowledge engine against the real sources (roadmap Stage 9.6).
// Run with: npm run test:kb   (needs the internet; a first run takes a few minutes because
// requests are paced, later runs use the cache). Options: --only=<text> to run matching
// questions, --verbose to print every answer, --offline to use only what is cached.
//
// It checks, in this order:
//   1. each connector still understands its site (parser drill);
//   2. every glossary quote is still on the page it cites;
//   3. the evaluation set (tests/knowledge-eval.json): accuracy, and zero uncited facts;
//   4. "what changed for my build": patch lines found for names, each tied to the official thread.
// Exit code 1 when anything fails. The cache is the normal one (AgentCache/knowledge), or
// POB_AGENT_CACHE when set.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).toLowerCase();
const verbose = args.includes("--verbose");
if (args.includes("--offline")) process.env.POB_KB_OFFLINE = "1";
process.env.POB_LIVE = "off";
process.env.POB_KB_LOG = "off";

const { Knowledge } = await import("../build/knowledge/engine.js");
const { GLOSSARY } = await import("../build/knowledge/glossary-data.js");
const { citationProblems, majorOf } = await import("../build/knowledge/types.js");

const kb = new Knowledge();
kb.fetcher.maxRequestsPerCall = 12;
const spec = JSON.parse(fs.readFileSync(path.join(here, "knowledge-eval.json"), "utf8"));
const failures = [];
const fail = (section, message) => { failures.push(`[${section}] ${message}`); console.log(`  FAIL ${message}`); };
const squash = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
const call = async (run) => { kb.fetcher.beginCall(); return run(); };

// ----- 1. parser drill -----------------------------------------------------------------------------
console.log("1. Sources");
const version = await call(() => kb.versions.info());
console.log(`  live version ${version.current.version} (${version.current.released ?? "release date unknown"}), source ${version.fact.source} ${version.fact.url}`);
if (!/^\d+\.\d+\.\d+/.test(version.current.version)) fail("sources", `no live version found: ${version.notes.join(" ")}`);
if (citationProblems(version.fact).length) fail("sources", "the version fact is not citable");
if (version.known.length < 20) fail("sources", `the wiki's version table has only ${version.known.length} rows`);
if (version.threads.length < 3) fail("sources", `GGG's patch-notes forum gave only ${version.threads.length} version threads`);
try {
  const notes = await call(() => kb.ggg.notes(version.threads[0]));
  console.log(`  GGG: "${notes.title}" has ${notes.lines.length} lines, posted ${notes.posted_at?.slice(0, 10)}`);
  if (!notes.lines.length || !notes.posted_at) fail("sources", "the newest patch-notes thread could not be parsed");
} catch (error) { fail("sources", `GGG patch notes: ${error.message}`); }
try {
  const item = await call(() => kb.poedb.entity("Hyrri's Ire"));
  console.log(`  poedb: Hyrri's Ire has ${item?.modLines.length ?? 0} mod lines and ${item?.history.length ?? 0} history rows`);
  if (!item || item.modLines.length < 3 || !item.history.length) fail("sources", "poedb's item page could not be parsed");
} catch (error) { fail("sources", `poedb: ${error.message}`); }
for (const wiki of [kb.wiki, kb.wiki2]) {
  try {
    const page = await call(() => wiki.page("Resistance"));
    console.log(`  ${wiki.site.source}: "Resistance" has ${page?.extract.length ?? 0} characters, edited ${page?.edited_at?.slice(0, 10)}`);
    if (!page || page.extract.length < 500 || !page.edited_at) fail("sources", `${wiki.site.source} page could not be read`);
  } catch (error) { fail("sources", `${wiki.site.source}: ${error.message}`); }
}
const pobVersion = kb.pob.version();
console.log(`  PoB data: ${pobVersion ? `PoB ${pobVersion.pob}, game ${pobVersion.game}` : "not found"}`);
if (!pobVersion || !kb.pob.unique("Hyrri's Ire").length || !kb.pob.gem("Fireball")) fail("sources", "PoB's data files could not be read");

// ----- 2. glossary quotes --------------------------------------------------------------------------
console.log(`2. Glossary: ${GLOSSARY.length} entries`);
let quotes = 0;
for (const entry of GLOSSARY) {
  if (only && !entry.term.toLowerCase().includes(only)) continue;
  for (const [wiki, side] of [[kb.wiki, entry], ...(entry.poe2 ? [[kb.wiki2, entry.poe2]] : [])]) {
    quotes++;
    try {
      const page = await call(() => wiki.page(side.page, wiki === kb.wiki ? version.current.version : undefined));
      if (!page) fail("glossary", `${entry.term}: ${wiki.site.source} has no page "${side.page}"`);
      else if (!squash(page.extract).includes(squash(side.quote))) fail("glossary", `${entry.term}: the quote is no longer on ${page.url}: "${side.quote}"`);
    } catch (error) { fail("glossary", `${entry.term}: ${error.message}`); }
  }
  if (majorOf(entry.version) !== majorOf(version.current.version)) console.log(`  note: "${entry.term}" was checked for ${entry.version}; the game is now ${version.current.version}`);
}
console.log(`  ${quotes} quotes checked`);

// ----- 3. evaluation set ---------------------------------------------------------------------------
const questions = spec.questions.filter((q) => !only || JSON.stringify(q).toLowerCase().includes(only));
console.log(`3. Evaluation set: ${questions.length} questions`);
let passed = 0, uncited = 0, factsSeen = 0;
const wrong = [];
for (const q of questions) {
  let ok = false, detail = "";
  let facts = [];
  try {
    if (q.claim) {
      const r = await call(() => kb.verify(q.query, q.claim));
      facts = [...r.facts, ...r.evidence];
      ok = r.verdict === q.verdict && (q.verdict === "not found" || r.evidence.length > 0);
      detail = `verdict ${r.verdict}${r.evidence[0] ? `: "${r.evidence[0].text}"` : ""}`;
    } else if (q.patch) {
      const r = await call(() => kb.patch({ version: q.patch, filter: q.filter }));
      facts = r.facts;
      ok = facts.some((f) => f.source === "ggg" && q.expect.every((e) => squash(f.text).includes(squash(e))));
      detail = `${facts.length} lines`;
    } else {
      const r = await call(() => kb.lookup(q.query, { source: q.source }));
      facts = r.facts;
      if (q.none) {
        const presented = facts.filter((f) => !(f.flags ?? []).some((flag) => /does not match the question/.test(flag)));
        ok = presented.length === 0;
        detail = `${presented.length} facts presented`;
      } else {
        const hit = facts.find((f) => (!q.from || f.source === q.from) && (q.game ? f.game === q.game : f.game === "poe1") && q.expect.every((e) => squash(`${f.text} ${f.quote ?? ""}`).includes(squash(e))));
        ok = !!hit;
        detail = hit ? `${hit.source} ${hit.game_version} ${hit.url}` : `not in ${facts.length} facts`;
      }
    }
  } catch (error) { detail = `error: ${error.message}`; }
  for (const f of facts) { factsSeen++; if (citationProblems(f).length) { uncited++; fail("citations", `uncited fact for "${q.query ?? q.filter}": ${JSON.stringify(f).slice(0, 200)}`); } }
  if (ok) passed++; else wrong.push(`${q.q} (${q.query ?? `${q.patch} ${q.filter ?? ""}`}${q.claim ? ` | ${q.claim}` : ""}) -> ${detail}`);
  if (verbose || !ok) console.log(`  ${ok ? "ok  " : "MISS"} ${q.q} -> ${detail}`);
}
const rate = questions.length ? passed / questions.length : 1;
console.log(`  accuracy ${passed}/${questions.length} (${(rate * 100).toFixed(1)}%), facts returned ${factsSeen}, uncited facts ${uncited}`);
if (rate < spec.pass_rate) fail("evaluation", `accuracy ${(rate * 100).toFixed(1)}% is below ${(spec.pass_rate * 100).toFixed(0)}%`);
if (uncited) fail("evaluation", `${uncited} uncited facts (must be zero)`);

// ----- 4. what changed for my build ----------------------------------------------------------------
console.log("4. What changed for my build");
try {
  const league = majorOf(version.current.version);
  const all = await call(() => kb.patch({ version: league }));
  // Take real gem names from the league's own notes, then ask for them the way kb_patch { build: true } does.
  const names = [...new Set(all.facts.flatMap((f) => kb.pob.namesIn(f.text)).filter((n) => kb.pob.gem(n)))].slice(0, 4).map((n) => kb.pob.gem(n).name);
  const mine = await call(() => kb.patch({ version: league, names: [...names, "Zzyzx Flibbertigibbet"] }));
  console.log(`  ${league}: asked for ${names.join(", ") || "(no gem is named in these notes)"} -> ${mine.facts.length} lines; not named: ${mine.unmatched.join(", ")}`);
  for (const f of mine.facts) {
    if (citationProblems(f).length || f.source !== "ggg" || !/^https:\/\/www\.pathofexile\.com\/forum\/view-thread\/\d+$/.test(f.url)) fail("build", `a patch line is not tied to the official thread: ${f.title}`);
    if (!names.some((n) => f.text.toLowerCase().includes(n.toLowerCase()))) fail("build", `a returned line names none of the asked names: "${f.text.slice(0, 120)}"`);
    if (majorOf(f.game_version) !== league) fail("build", `a line from ${f.game_version} was returned for ${league}`);
  }
  if (names.length && mine.facts.length < names.length) fail("build", "fewer lines than names that the notes do mention");
  if (!mine.unmatched.includes("Zzyzx Flibbertigibbet")) fail("build", "an unknown name was not reported as not named");
} catch (error) { fail("build", error.message); }

console.log(`\nRequests made: ${kb.fetcher.requests} (the rest came from the cache).`);
if (failures.length) {
  console.log(`\n${failures.length} problem(s):\n${failures.map((f) => "- " + f).join("\n")}`);
  if (wrong.length) console.log(`\nMissed questions:\n${wrong.map((w) => "- " + w).join("\n")}`);
  process.exit(1);
}
if (wrong.length) console.log(`\nMissed questions (within the allowed margin):\n${wrong.map((w) => "- " + w).join("\n")}`);
console.log("\nKnowledge engine: all checks passed.");
