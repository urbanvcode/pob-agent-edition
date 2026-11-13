/**
 * Knowledge tools (roadmap Stage 9): cited Path of Exile facts.
 * Two tools keep the definitions small: kb_lookup (facts, glossary, claim
 * check, PoE2 comparison) and kb_patch (official patch notes, also "what
 * changed for my build").
 */
import { Knowledge, type BuildName, type LookupResult, type LookupSource, type PatchResult, type VerifyResult } from "../knowledge/engine.js";
import { glossaryTerms } from "../knowledge/glossary.js";
import { citationProblems, KbError, SOURCES, type Fact } from "../knowledge/types.js";
import type { VersionInfo } from "../knowledge/versions.js";
import { ToolError, type Pob } from "../pob.js";
import { S, tool, type Tool } from "../registry.js";

const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : "?");

export function versionLine(v: VersionInfo): string {
  const parts = [`Live Path of Exile 1 version: ${v.current.version}${v.current.released ? ` (released ${v.current.released})` : ""} [${v.fact.source}: ${v.fact.url}, read ${day(v.fact.retrieved_at)}]`];
  if (v.announced) parts.push(`Announced, not live yet: ${v.announced.version}${v.announced.released ? ` (${v.announced.released})` : ""} [ggg: ${v.announced.url}]`);
  if (v.installed) parts.push(`Installed game: ${v.installed.client}${v.installed.build ? ` build ${v.installed.build}` : ""}, last patched ${day(v.installed.updated_at)}`);
  return parts.join("\n");
}

/** One fact as text. A fact that cannot be cited is never shown as a fact. */
export function formatFact(fact: Fact, index: number): string {
  const problems = citationProblems(fact);
  if (problems.length) return `[${index}] (dropped: a fact about "${fact.title}" had ${problems.join(", ")})`;
  const info = SOURCES[fact.source];
  const head = `[${index}] ${fact.title} | ${fact.source} (${info.label}; rank ${info.rank}) | ${fact.game === "poe2" ? "PATH OF EXILE 2" : "PoE1"} ${fact.game_version}` +
    `${fact.edited_at ? ` | source dated ${day(fact.edited_at)}` : ""} | read ${day(fact.retrieved_at)}`;
  const lines = [head, `    ${fact.url}`, `    ${fact.kind === "glossary" ? fact.text : `"${fact.text}"`}`];
  if (fact.quote) lines.push(`    source wording: "${fact.quote}"`);
  for (const flag of fact.flags ?? []) lines.push(`    ! ${flag}`);
  return lines.join("\n");
}

const RULES = "Cite the source and game version for each fact you use. Anything not listed here is unverified: say so instead of answering from memory. Numbers for the player's build come from PoB tools (stats, what_if), not from these texts.";

export function formatLookup(query: string, r: LookupResult): string {
  const lines = [versionLine(r.version), ""];
  if (!r.facts.length) {
    lines.push(`No source found for "${query}". Do not answer from memory: say it could not be verified. Try the exact name of the item, gem or mechanic, or source "poedb".`);
  } else {
    lines.push(`Facts for "${query}" (highest-ranked source first after the glossary):`);
    r.facts.forEach((fact, i) => lines.push(formatFact(fact, i + 1)));
  }
  if (r.notes.length) lines.push("", "Notes:", ...r.notes.map((n) => `- ${n}`));
  if (r.related.length) lines.push("", `Related wiki pages: ${r.related.join(", ")}`);
  lines.push("", RULES);
  return lines.join("\n");
}

export function formatVerify(claim: string, r: VerifyResult): string {
  const lines = [versionLine(r.version), "", `Claim: "${claim}"`, `Verdict: ${r.verdict.toUpperCase()} (word-and-number match; read the evidence before repeating it)`, `Why: ${r.reason}`];
  if (r.evidence.length) { lines.push("", "Evidence:"); r.evidence.forEach((fact, i) => lines.push(formatFact(fact, i + 1))); }
  if (r.notes.length) lines.push("", "Notes:", ...r.notes.map((n) => `- ${n}`));
  lines.push("", RULES);
  return lines.join("\n");
}

/** Patch notes are many lines from few threads: cite each thread once, then its lines. */
export function formatPatch(r: PatchResult, what: string, limit = 40, things?: BuildName[]): string {
  const lines = [versionLine(r.version), ""];
  if (r.facts.length) {
    lines.push(`${r.facts.length} line${r.facts.length === 1 ? "" : "s"}${what ? ` ${what}` : ""} in the official ${r.scope} patch notes${r.facts.length > limit ? ` (first ${limit} shown; narrow with filter)` : ""}:`);
    const shown = r.facts.slice(0, limit).filter((fact) => !citationProblems(fact).length);
    for (const thread of r.threads) {
      const mine = shown.filter((fact) => fact.url === thread.url);
      if (!mine.length) continue;
      lines.push(`Source: ggg (${SOURCES.ggg.label}; rank ${SOURCES.ggg.rank}) | "${thread.title}" | PoE1 ${thread.version} | posted ${day(thread.posted_at)} | read ${day(thread.retrieved_at)}${thread.stale ? " | CACHED COPY, site not reachable" : ""}`, `  ${thread.url}`);
      for (const fact of mine) {
        const where = fact.title.slice(thread.title.length).replace(/^ > /, "");
        lines.push(`  - ${where ? `[${where}] ` : ""}"${fact.text}"`);
      }
    }
  } else {
    const threads = r.threads.map((t) => `"${t.title}" (${t.version}, posted ${day(t.posted_at)}, ${t.url})`);
    lines.push(`Official patch notes read for ${r.scope}: ${threads.join("; ") || "none"}`, `No line${what ? ` ${what}` : ""} in these notes.`);
  }
  if (r.unmatched.length && things) {
    // Gems, uniques and the ascendancy by name; passives only as a count (a build has dozens).
    const left = (kind: BuildName["kind"]) => things.filter((t) => t.kind === kind && r.unmatched.includes(t.name)).map((t) => t.name);
    const parts = [["gems", left("gem")], ["unique items", left("unique")], ["ascendancy", left("ascendancy")]].filter(([, names]) => names.length).map(([label, names]) => `${label}: ${(names as string[]).join(", ")}`);
    const passives = left("passive").length;
    if (passives) parts.push(`${passives} keystones and notables`);
    lines.push("", `Not named in these notes: ${parts.join("; ")}.`);
  } else if (r.unmatched.length) lines.push("", `Not named in these notes (${r.unmatched.length}): ${r.unmatched.join(", ")}`);
  if (!r.facts.length || r.unmatched.length) {
    const sections = r.sections.filter((s) => s.lines > 0).map((s) => `${s.section} (${s.lines})`);
    lines.push("", `Sections in these notes: ${[...new Set(sections)].join(", ")}.`, "General changes (to a mechanic, an ascendancy, monsters) can affect a build without naming its gems or items: read a section with filter before saying nothing changed.");
  }
  if (r.notes.length) lines.push("", "Notes:", ...r.notes.map((n) => `- ${n}`));
  lines.push("", RULES);
  return lines.join("\n");
}

/** Gems, unique items, keystones, notables and the ascendancy of the open build (from PoB). */
export async function buildNames(pob: Pob): Promise<{ names: BuildName[]; build: string }> {
  const link = await pob.link();
  const { summary } = await link.call("summary");
  const names = new Map<string, BuildName>();
  const add = (name: unknown, kind: BuildName["kind"]) => { const n = String(name ?? "").trim(); if (n && n !== "None" && !names.has(n)) names.set(n, { name: n, kind }); };
  for (const group of summary?.groups ?? []) for (const gem of group.gems ?? []) add(String(gem.name ?? "").replace(/^(Awakened|Anomalous|Divergent|Phantasmal) /, ""), "gem");
  for (const item of summary?.items ?? []) if (item.name && /^(UNIQUE|RELIC)$/i.test(String(item.rarity ?? ""))) add(String(item.name).split(",")[0], "unique");
  for (const key of ["keystones", "notables"]) for (const node of summary?.tree?.[key] ?? []) add(node, "passive");
  add(summary?.ascendancy, "ascendancy");
  return { names: [...names.values()], build: String(summary?.name ?? "the open build") };
}

function wrap<T>(run: () => Promise<T>): Promise<T> {
  return run().catch((error) => { throw error instanceof KbError ? new ToolError(error.message) : error; });
}

const SOURCES_ARG: LookupSource[] = ["auto", "glossary", "pob", "wiki", "poedb", "ggg", "poe2"];

export function knowledgeTools(provided?: Knowledge): Tool[] {
  // Created on first use: starting the server touches neither the cache folder nor the network.
  const kb = () => (provided ??= new Knowledge());
  return [
    tool("kb_lookup",
      "Cited game facts for a topic (mechanic, unique, gem, term): glossary with PoE2 comparison, PoB data, poewiki, poedb, GGG patch notes. Each fact has source, URL, game version and date; outdated or conflicting ones are flagged. Use before stating any game fact. With claim: checks the statement (supported / contradicted / not found).",
      {
        query: S.str("Topic or exact name, e.g. Spell Suppression, Hyrri's Ire"),
        claim: S.str("Statement about the topic to check"),
        source: S.enum(SOURCES_ARG, "Default auto; poe2 = Path of Exile 2 wiki"),
        refresh: S.bool("Re-read instead of using the cache"),
      },
      ["query"],
      async (_ctx, args) => wrap(async () => {
        const engine = kb();
        engine.fetcher.beginCall();
        const query = String(args.query ?? "");
        const options = { source: SOURCES_ARG.includes(args.source) ? (args.source as LookupSource) : undefined, refresh: args.refresh === true };
        if (typeof args.claim === "string" && args.claim.trim()) return formatVerify(args.claim.trim(), await engine.verify(query, args.claim.trim(), options));
        const result = await engine.lookup(query, options);
        const text = formatLookup(query, result);
        return result.facts.length || options.source ? text : `${text}\nGlossary terms: ${glossaryTerms().join(", ")}.`;
      })),

    tool("kb_patch",
      "Official GGG patch notes with links: what changed in a version or league (default: the live league), filtered by text, or only the lines naming the open build's gems, uniques, keystones, notables and ascendancy (build: true).",
      {
        version: S.str("e.g. 3.30 (league) or 3.30.0b (one patch)"),
        filter: S.str("Text or section, e.g. Winter Orb, Ascendancy"),
        build: S.bool("Only what names things in the open build"),
      },
      [],
      async ({ pob }, args) => wrap(async () => {
        const engine = kb();
        engine.fetcher.beginCall();
        const version = typeof args.version === "string" ? args.version : undefined;
        const filter = typeof args.filter === "string" && args.filter.trim() ? args.filter.trim() : undefined;
        if (args.build === true) {
          const { names, build } = await buildNames(pob);
          const result = await engine.patch({ version, filter, build: names });
          return `Checked ${names.length} names from ${build} (gems, unique items, keystones, notables, ascendancy).\n` + formatPatch(result, `naming something in ${build}`, 40, names);
        }
        const result = await engine.patch({ version, filter });
        if (!filter && result.facts.length > 60) {
          const sections = result.sections.map((s) => `${s.section} (${s.lines})`);
          return [versionLine(result.version), "", `Official patch notes for ${result.scope}: ${result.threads.map((t) => `"${t.title}" (${t.version}, ${t.url})`).join("; ")}`,
            `${result.facts.length} lines in these sections: ${[...new Set(sections)].join(", ")}.`, "Call again with filter (a section name or any text) or build: true to read the lines.", ...result.notes.map((n) => `- ${n}`)].join("\n");
        }
        return formatPatch(result, filter ? `matching "${filter}"` : "");
      })),
  ];
}
