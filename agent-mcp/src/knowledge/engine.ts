/**
 * The knowledge engine: answers "what do the sources say about X?" with cited
 * facts, never with anything of its own.
 *
 * Accuracy rules (roadmap Stage 9.1) as implemented here:
 *  1. No source, no claim: every fact has source, url, game_version, retrieved_at.
 *  2. Version-aware: facts older than the live version are flagged.
 *  3. Source hierarchy: facts are ordered game/GGG > PoB > poedb > wiki, and
 *     disagreements are reported, not hidden.
 *  4. No numbers of its own: build numbers come from PoB's simulation tools.
 *  5. Freshness: cached pages are tied to the game version they were read
 *     under and are re-read after a patch.
 *  6. Nothing here comes from a model's memory.
 *  7. PoE2 facts come only from poe2wiki, are labelled, and are never mixed in
 *     unless asked for.
 */
import fs from "fs";
import path from "path";
import { cacheDir } from "../paths.js";
import { PoliteFetcher } from "./fetcher.js";
import { findGlossary, wikiUrl, type GlossaryEntry } from "./glossary.js";
import { GggPatchNotes, type PatchLine, type PatchNotes } from "./sources/ggg.js";
import { PobData } from "./sources/pobdata.js";
import { Poedb } from "./sources/poedb.js";
import { POE2WIKI, POEWIKI, titleFit, Wiki, type WikiPage } from "./sources/poewiki.js";
import { clip, keyWords, numbersIn, passagesOf, scoreText, sentencesOf } from "./text.js";
import { compareVersions, KbError, majorOf, SOURCES, type Fact, type GameVersion } from "./types.js";
import { Versions, type VersionInfo, type VersionsOptions } from "./versions.js";

export type LookupSource = "auto" | "glossary" | "pob" | "wiki" | "poedb" | "ggg" | "poe2";

export interface LookupOptions {
  source?: LookupSource;
  refresh?: boolean;
  /** Rank wiki passages by these words instead of the query (used when checking a claim). */
  rankBy?: string;
  /** Wiki passages to return (default 3). */
  passages?: number;
}

export interface LookupResult {
  version: VersionInfo;
  facts: Fact[];
  /** Disagreements, outdated sources, things that could not be read. */
  notes: string[];
  /** Other wiki pages that may be relevant. */
  related: string[];
}

export type Verdict = "supported" | "contradicted" | "not found";

export interface VerifyResult extends LookupResult {
  verdict: Verdict;
  /** The sentences the verdict rests on. */
  evidence: Fact[];
  reason: string;
}

export interface PatchResult {
  version: VersionInfo;
  /** What was asked for: a full version ("3.30.0b") or a league ("3.30"). */
  scope: string;
  threads: PatchNotes[];
  facts: Fact[];
  /** Section name -> number of lines, per thread title. */
  sections: Array<{ thread: string; section: string; lines: number }>;
  /** Names that were looked for and matched nothing. */
  unmatched: string[];
  notes: string[];
}

export interface KnowledgeOptions extends VersionsOptions {
  fetcher?: PoliteFetcher;
  pob?: PobData;
}

const phrase = (name: string) => new RegExp(`(^|[^A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![A-Za-z0-9])`, "i");

function normaliseMod(line: string): string {
  return line.toLowerCase().replace(/[–—]/g, "-").replace(/[+\s]/g, "");
}

export class Knowledge {
  readonly fetcher: PoliteFetcher;
  readonly pob: PobData;
  readonly wiki: Wiki;
  readonly wiki2: Wiki;
  readonly ggg: GggPatchNotes;
  readonly poedb: Poedb;
  readonly versions: Versions;
  private readonly now: () => number;

  constructor(options: KnowledgeOptions = {}) {
    this.fetcher = options.fetcher ?? new PoliteFetcher();
    this.pob = options.pob ?? new PobData();
    this.wiki = new Wiki(this.fetcher, POEWIKI);
    this.wiki2 = new Wiki(this.fetcher, POE2WIKI);
    this.ggg = new GggPatchNotes(this.fetcher);
    this.poedb = new Poedb(this.fetcher);
    this.now = options.now ?? Date.now;
    this.versions = new Versions(this.wiki, this.ggg, this.fetcher, { ...options, fallback: options.fallback ?? (() => this.pob.version()?.game) });
  }

  private isoNow(): string { return new Date(this.now()).toISOString(); }

  // ----- lookup ---------------------------------------------------------------------------------

  async lookup(query: string, options: LookupOptions = {}): Promise<LookupResult> {
    const q = query.replace(/\s+/g, " ").trim();
    if (!q) throw new KbError("Give a topic to look up, e.g. \"Spell Suppression\" or \"Hyrri's Ire\".");
    const source = options.source ?? "auto";
    const version = await this.versions.info(!!options.refresh);
    const facts: Fact[] = [];
    const notes: string[] = [...version.notes];
    const related: string[] = [];
    const tag = version.current.version;
    const attempt = async (what: string, run: () => Promise<void>) => {
      try { await run(); } catch (error) {
        if (!(error instanceof KbError)) throw error;
        notes.push(`${what} not read: ${error.message}`);
      }
    };

    if (source === "poe2") {
      await attempt("poe2wiki", async () => { facts.push(...(await this.wikiFacts(this.wiki2, q, options, undefined, version, related))); });
      const g = findGlossary(q);
      if (g?.poe2) facts.unshift(this.glossaryFact(g, version, true));
      return { version, facts, notes, related };
    }

    const glossary = source === "auto" || source === "glossary" ? findGlossary(q) : undefined;
    if (glossary) {
      facts.push(this.glossaryFact(glossary, version, false));
      if (glossary.poe2) facts.push(this.glossaryFact(glossary, version, true));
    }

    // Entities PoB knows by exact name (a unique or a gem).
    const names: string[] = [];
    let pobMods: string[] | undefined, pobTitle: string | undefined;
    if (source === "auto" || source === "pob") {
      const pobFacts = this.pobFacts(q, version);
      facts.push(...pobFacts.facts);
      names.push(...pobFacts.names);
      pobMods = pobFacts.mods;
      pobTitle = pobFacts.names[0];
      if (source === "pob" && !pobFacts.facts.length) notes.push(this.pob.available() ? `PoB's data has no unique or gem named "${q}" (exact names only).` : "PoB's data files were not found next to the server.");
    }

    if (source === "auto" || source === "wiki") {
      await attempt("poewiki", async () => {
        const wikiFacts = await this.wikiFacts(this.wiki, q, options, glossary?.page ?? pobTitle, version, related);
        facts.push(...wikiFacts);
        const page = wikiFacts[0]?.title.split(" > ")[0];
        if (page && !names.some((n) => n.toLowerCase() === page.toLowerCase())) names.push(page);
      });
    }

    if (source === "poedb" || (source === "auto" && pobTitle)) {
      await attempt("poedb", async () => {
        const entity = await this.poedb.entity(pobTitle ?? q, tag, !!options.refresh);
        if (!entity) { if (source === "poedb") notes.push(`poedb has no page named "${q}" with an item box or version history (exact names only).`); return; }
        const flags = [...(entity.stale ? ["cached copy, poedb could not be reached"] : [])];
        if (entity.itemLines.length) {
          facts.push({ source: "poedb", title: entity.title, text: entity.itemLines.join("; "), url: entity.url, game: "poe1", game_version: version.current.version, retrieved_at: entity.retrieved_at, kind: "item", flags: [...flags, "poedb states no version on the page; it shows live datamined data, so the current version is assumed"] });
        }
        for (const row of entity.history.slice(0, 3)) {
          facts.push({ source: "poedb", title: `${entity.title} > Version history`, text: row.text, url: entity.url, game: "poe1", game_version: row.version, retrieved_at: entity.retrieved_at, kind: "history", ...(flags.length ? { flags } : {}) });
        }
        if (pobMods?.length && entity.modLines.length) {
          const a = new Map(pobMods.map((l) => [normaliseMod(l), l])), b = new Map(entity.modLines.map((l) => [normaliseMod(l), l]));
          const onlyPob = [...a].filter(([k]) => !b.has(k)).map(([, l]) => l), onlyDb = [...b].filter(([k]) => !a.has(k)).map(([, l]) => l);
          if (onlyPob.length || onlyDb.length) {
            const list = (lines: string[]) => lines.slice(0, 4).map((l) => `"${l}"`).join(", ") + (lines.length > 4 ? `, and ${lines.length - 4} more` : "");
            notes.push(`SOURCES DISAGREE on ${entity.title}: ${onlyPob.length ? `only in PoB: ${list(onlyPob)}` : ""}${onlyPob.length && onlyDb.length ? "; " : ""}${onlyDb.length ? `only on poedb: ${list(onlyDb)}` : ""}. PoB's data ranks higher (3 vs 4) but can lag a patch; say that the sources differ and check the newest patch notes (kb_patch).`);
          }
        }
      });
    }

    // Official patch notes of the live league that name the topic outrank everything above.
    if ((source === "auto" || source === "ggg") && version.current.version !== "unknown") {
      const lookFor = names.length ? names : glossary ? [glossary.term] : [q];
      await attempt("GGG patch notes", async () => {
        const entities = this.pob.available() ? lookFor.filter((n) => this.pob.unique(n).length || this.pob.gem(n)) : [];
        const patch = await this.patch({ version: majorOf(version.current.version), names: lookFor, max: 3, subjectOnly: lookFor.filter((n) => !entities.includes(n)) });
        if (patch.facts.length) {
          facts.push(...patch.facts);
          notes.push(`GGG's ${patch.scope} patch notes mention ${[...new Set(lookFor.filter((n) => patch.facts.some((f) => phrase(n).test(f.text))))].join(", ")}: official notes outrank PoB, poedb and wiki text written before them.`);
        }
        notes.push(...patch.notes);
      });
    }

    facts.sort((x, y) => SOURCES[x.source].rank - SOURCES[y.source].rank);
    // The glossary summary reads first: it is the short answer, backed by its quote.
    facts.sort((x, y) => Number(y.kind === "glossary") - Number(x.kind === "glossary"));
    this.log("lookup", q, facts);
    return { version, facts, notes: [...new Set(notes)], related: [...new Set(related)] };
  }

  private glossaryFact(entry: GlossaryEntry, version: VersionInfo, poe2: boolean): Fact {
    const side = poe2 ? entry.poe2! : entry;
    const flags: string[] = [];
    if (!poe2 && version.current.version !== "unknown" && majorOf(entry.version) !== majorOf(version.current.version)) {
      flags.push(`glossary entry was checked for ${entry.version}; the game is now ${version.current.version}: confirm with the wiki passage or patch notes`);
    }
    return {
      source: poe2 ? "poe2wiki" : "poewiki",
      title: poe2 ? `${entry.term} in Path of Exile 2 (glossary)` : `${entry.term} (glossary)`,
      text: side.text,
      quote: side.quote,
      url: wikiUrl(side.page, poe2),
      game: poe2 ? "poe2" : "poe1",
      game_version: poe2 ? entry.poe2!.version : entry.version,
      retrieved_at: entry.checked,
      kind: "glossary",
      ...(flags.length ? { flags } : {}),
    };
  }

  private pobFacts(query: string, version: VersionInfo): { facts: Fact[]; names: string[]; mods?: string[] } {
    const facts: Fact[] = [], names: string[] = [];
    let mods: string[] | undefined;
    if (!this.pob.available()) return { facts, names };
    const pobVersion = this.pob.version();
    const gameVersion = pobVersion?.game ?? "unknown";
    const flags: string[] = [];
    if (pobVersion && version.current.version !== "unknown" && compareVersions(pobVersion.game, majorOf(version.current.version)) < 0) {
      flags.push(`PoB ${pobVersion.pob} data is for ${pobVersion.game}; the game is now ${version.current.version}: may lag the patch`);
    }
    const base = { source: "pob" as const, game: "poe1" as const, game_version: gameVersion, retrieved_at: this.isoNow(), ...(flags.length ? { flags } : {}) };
    const exactUnique = this.pob.unique(query), exactGem = this.pob.gem(query);
    const wanted = exactUnique.length || exactGem ? [query] : this.pob.namesIn(query).slice(0, 2);
    for (const name of wanted) {
      for (const unique of this.pob.unique(name)) {
        const parts = [`${unique.name} (${unique.base})`, ...unique.info, ...unique.mods];
        if (unique.oldVariants.length) parts.push(`Older versions PoB also knows: ${unique.oldVariants.join(", ")}`);
        facts.push({ ...base, title: `${unique.name} (PoB ${pobVersion?.pob ?? "?"})`, text: parts.join("; "), url: this.pob.url(unique.file), kind: "item" });
        if (!names.includes(unique.name)) names.push(unique.name);
        mods ??= unique.mods;
      }
      const gem = this.pob.gem(name);
      if (gem && !this.pob.unique(name).length) {
        const req = [gem.reqStr && `Str ${gem.reqStr}%`, gem.reqDex && `Dex ${gem.reqDex}%`, gem.reqInt && `Int ${gem.reqInt}%`].filter(Boolean).join(", ");
        const parts = [`${gem.name}: ${gem.support ? "support gem" : "skill gem"}`, gem.tags && `tags: ${gem.tags}`, gem.description, gem.castTime && !gem.support && `cast/attack time ${gem.castTime} s (0 = uses the weapon's attack time)`, req && `attribute requirement share: ${req}`, gem.maxLevel && `max level without bonuses ${gem.maxLevel}`].filter(Boolean) as string[];
        facts.push({ ...base, title: `${gem.name} (PoB ${pobVersion?.pob ?? "?"})`, text: parts.join("; "), url: this.pob.url(gem.file), kind: "gem" });
        if (!names.includes(gem.name)) names.push(gem.name);
      }
    }
    return { facts, names, mods };
  }

  /** Pick the wiki page that fits the question best, then the passages that answer it. */
  private async wikiFacts(wiki: Wiki, query: string, options: LookupOptions, hint: string | undefined, version: VersionInfo, related: string[]): Promise<Fact[]> {
    const poe2 = wiki.site.game === "poe2";
    const tag = poe2 ? undefined : version.current.version;
    let best: WikiPage | null = null;
    let weak = false;
    if (hint) best = await wiki.page(hint, tag, !!options.refresh);
    if (!best) {
      const words = query.split(/\s+/).filter((w) => w.length > 3 && w.toLowerCase() !== query.toLowerCase()).slice(0, 3);
      const singular = words.map((w) => w.replace(/(?<=[a-z]{3})s$/i, "")).filter((w) => !words.includes(w));
      const direct = await wiki.intros([query, ...words, ...singular], tag);
      const fit = (p: WikiPage) => (p.asked?.some((a) => a.toLowerCase() === query.toLowerCase()) ? 1 : titleFit(query, p.title));
      let candidates = direct.map((p) => ({ p, fit: fit(p) }));
      if (!candidates.some((c) => c.fit >= 0.99)) {
        const found = await wiki.search(query, tag);
        candidates.push(...found.map((p, i) => ({ p, fit: Math.max(titleFit(query, p.title), 0.05 - i * 0.01) })));
      }
      candidates = candidates.sort((a, b) => b.fit - a.fit).filter((c, i, all) => all.findIndex((x) => x.p.title === c.p.title) === i);
      if (!candidates.length) return [];
      weak = candidates[0].fit < 0.2;
      related.push(...candidates.slice(1, 5).map((c) => c.p.title));
      best = (await wiki.page(candidates[0].p.title, tag, !!options.refresh)) ?? candidates[0].p;
    }

    const known = poe2 ? await wiki.versions().then((v) => v.versions, () => [] as GameVersion[]) : version.known;
    const editedUnder = Versions.at(known, best.edited_at);
    const flags: string[] = [];
    if (best.stale) flags.push("cached copy, the wiki could not be reached");
    if (weak) flags.push("best search hit, but its title does not match the question: check that it is about the right thing");
    if (!poe2 && version.current.version !== "unknown") {
      const release = Versions.majorRelease(version, version.current.version);
      if (release && best.edited_at && best.edited_at.slice(0, 10) < release) {
        flags.push(`page last edited ${best.edited_at.slice(0, 10)}, before ${majorOf(version.current.version)} was released (${release}): may be outdated`);
      }
    }
    if (!editedUnder) flags.push("the page states no game version");

    const all = passagesOf(best.extract);
    const words = keyWords(options.rankBy ?? query);
    const titleWords = keyWords(best.title);
    const rankWords = words.filter((w) => !titleWords.includes(w));
    // Rank by the words the title does not already cover; when nothing has those, by all of them.
    const score = (by: string[]) => all.map((p, i) => ({ p, i, score: scoreText(by, p.text, p.heading) }));
    let scored = score(rankWords.length ? rankWords : words);
    if (rankWords.length && !scored.some((x) => x.i > 0 && x.score > 0)) scored = score(words);
    const ranked = scored
      .filter((x) => x.i === 0 || (x.score > 0 && x.p.text.length > 40))
      .sort((a, b) => (b.i === 0 ? 1 : 0) - (a.i === 0 ? 1 : 0) || b.score - a.score || a.i - b.i)
      .slice(0, hint && !rankWords.length && !options.rankBy ? 1 : options.passages ?? 3);
    return ranked.map(({ p }) => ({
      source: wiki.site.source,
      title: p.heading ? `${best!.title} > ${p.heading}` : best!.title,
      text: clip(p.text, 700),
      url: best!.url,
      game: wiki.site.game,
      game_version: editedUnder ?? "unknown",
      retrieved_at: best!.retrieved_at,
      edited_at: best!.edited_at,
      kind: "page" as const,
      ...(flags.length ? { flags: [...flags] } : {}),
    }));
  }

  // ----- verify ---------------------------------------------------------------------------------

  /**
   * Check a statement against the sources for a topic. A word-and-number match,
   * not understanding: the evidence is always returned so it can be read.
   */
  async verify(topic: string, claim: string, options: LookupOptions = {}): Promise<VerifyResult> {
    const result = await this.lookup(topic, { ...options, rankBy: claim, passages: 5 });
    const claimNumbers = numbersIn(claim);
    const words = keyWords(claim).filter((w) => !/^\d/.test(w));
    if (!words.length) throw new KbError("The claim has no words to check. State it as a sentence, e.g. \"The default maximum resistance is 75%\".");
    let best: { fact: Fact; sentence: string; overlap: number; numbers: string[] } | undefined;
    let supported: typeof best, contradicted: typeof best;
    for (const fact of result.facts) {
      if (fact.game !== "poe1") continue;
      // A glossary summary is our wording: only the source quote behind it counts as evidence.
      for (const sentence of fact.kind === "glossary" ? (fact.quote ? [fact.quote] : []) : sentencesOf(fact.text)) {
        const overlap = scoreText(words, `${fact.title} ${sentence}`.replace(/\(glossary\)/, ""));
        const numbers = numbersIn(sentence);
        const candidate = { fact, sentence, overlap, numbers };
        if (!best || overlap > best.overlap) best = candidate;
        if (overlap < 0.6) continue;
        const hasAll = claimNumbers.every((n) => numbers.includes(n));
        if (claimNumbers.length ? hasAll : overlap >= 0.75) { if (!supported || overlap > supported.overlap) supported = candidate; }
        else if (claimNumbers.length && numbers.length && !claimNumbers.some((n) => numbers.includes(n)) && overlap >= 0.75) { if (!contradicted || overlap > contradicted.overlap) contradicted = candidate; }
      }
    }
    const pick = supported ?? contradicted;
    const verdict: Verdict = supported ? "supported" : contradicted ? "contradicted" : "not found";
    const evidence = pick ? [{ ...pick.fact, text: pick.sentence }] : best && best.overlap >= 0.4 ? [{ ...best.fact, text: best.sentence }] : [];
    const reason = supported
      ? `A source sentence has the claim's key words${claimNumbers.length ? " and every number in it" : ""}.`
      : contradicted
        ? `A source sentence about the same thing gives different numbers (${contradicted.numbers.join(", ")}) than the claim (${claimNumbers.join(", ")}).`
        : "No source sentence matches the claim closely enough. That is not proof it is false: say it is unverified.";
    return { ...result, verdict, evidence, reason };
  }

  // ----- patch notes ----------------------------------------------------------------------------

  /**
   * Official patch notes. `version` is a full version ("3.30.0b") or a league
   * ("3.30" = the content update and every patch after it); default: the live league.
   */
  async patch(options: { version?: string; filter?: string; names?: string[]; max?: number; subjectOnly?: string[] } = {}): Promise<PatchResult> {
    const version = await this.versions.info();
    const notes: string[] = [];
    const asked = (options.version ?? "").trim().toLowerCase().replace(/^v/, "");
    if (asked && !/^\d+\.\d+(\.\d+[a-z]?)?$/.test(asked)) throw new KbError(`"${options.version}" is not a game version. Use e.g. "3.30" (the whole league) or "3.30.0b" (one patch).`);
    const scope = asked || majorOf(version.current.version);
    if (scope === "0.0") throw new KbError("The current game version is not known (no source could be reached); name a version, e.g. \"3.30\".");
    const wholeLeague = /^\d+\.\d+$/.test(scope);
    const matches = (v: string) => (wholeLeague ? majorOf(v) === scope : v === scope);
    const isLaunch = (v: string) => /^\d+\.\d+\.0$/.test(v);
    let threads = version.threads.filter((t) => matches(t.version));
    // A league's notes start with its x.y.0 content update, which may sit on a later forum page.
    const complete = () => threads.length > 0 && (!wholeLeague || threads.some((t) => isLaunch(t.version)));
    for (let pages = 2; !complete() && pages <= 4; pages++) {
      let more;
      try { more = await this.ggg.list(pages); } catch (error) {
        if (!(error instanceof KbError)) throw error;
        notes.push(`Older forum pages not read: ${error.message}`);
        break;
      }
      threads = more.threads.filter((t) => matches(t.version));
      if (more.threads.length && more.threads.every((t) => compareVersions(t.version, wholeLeague ? `${scope}.0` : scope) < 0)) break;
    }
    if (!threads.length) throw new KbError(`No patch-notes thread for ${scope} on the first pages of GGG's patch-notes forum (https://www.pathofexile.com/forum/view-forum/patch-notes). Older notes are not fetched; say that this could not be checked.`);
    if (wholeLeague && !threads.some((t) => isLaunch(t.version))) notes.push(`The ${scope}.0 content update thread was not found on the forum pages read: only later patches of ${scope} are included.`);
    // The content update first (it holds most changes), then the newest patches.
    threads = threads.slice().sort((a, b) => Number(isLaunch(b.version)) - Number(isLaunch(a.version)) || compareVersions(b.version, a.version));

    const read: PatchNotes[] = [];
    const skipped: string[] = [];
    for (const thread of threads) {
      try { read.push(await this.ggg.notes(thread)); } catch (error) {
        if (!(error instanceof KbError)) throw error;
        if (/Request limit/.test(error.message)) skipped.push(`${thread.version} "${thread.title}"`);
        else notes.push(`Not read: "${thread.title}" (${thread.url}): ${error.message}`);
      }
    }
    if (skipped.length) notes.push(`Not read yet (request limit per question, to stay polite): ${skipped.join(", ")}. Call again to read more; what was read is cached.`);
    if (version.announced && !asked) notes.push(`GGG has announced ${version.announced.version} (${version.announced.url}); it is not live yet, so these are the notes of the live league. Ask for version "${majorOf(version.announced.version)}" to read the announced changes.`);

    const names = (options.names ?? []).filter((n) => n.trim().length > 2);
    const patterns = names.map((n) => ({ name: n, re: phrase(n) }));
    const filterWords = options.filter ? keyWords(options.filter) : [];
    const filterPhrase = options.filter?.trim().toLowerCase();
    const facts: Fact[] = [];
    const sections: PatchResult["sections"] = [];
    const matched = new Set<string>();
    for (const thread of read) {
      const count = new Map<string, number>();
      const perName = new Map<string, number>();
      for (const line of thread.lines) {
        count.set(line.section, (count.get(line.section) ?? 0) + 1);
        const hay = `${line.section}: ${line.parent ?? ""} ${line.text}`;
        let hit: string | undefined;
        if (patterns.length) {
          // A common word ("Resistance") only counts when the line starts with it, i.e. is about it.
          hit = patterns.find((p) => p.re.test(options.subjectOnly?.includes(p.name) ? line.text.slice(0, p.name.length + 6) : `${line.parent ?? ""} | ${line.text}`))?.name;
          if (!hit) continue;
          if (options.max && (perName.get(hit) ?? 0) >= options.max) continue;
          perName.set(hit, (perName.get(hit) ?? 0) + 1);
          matched.add(hit);
        }
        if (filterPhrase && !hay.toLowerCase().includes(filterPhrase) && scoreText(filterWords, hay) < 1) continue;
        facts.push(this.patchFact(thread, line, hit));
      }
      for (const [section, lines] of count) sections.push({ thread: thread.title, section: section || "(no heading)", lines });
    }
    this.log("patch", `${scope} ${options.filter ?? ""} ${names.length ? `[${names.length} names]` : ""}`.trim(), facts);
    return { version, scope, threads: read, facts, sections, unmatched: names.filter((n) => !matched.has(n)), notes };
  }

  private patchFact(thread: PatchNotes, line: PatchLine, about?: string): Fact {
    return {
      source: "ggg",
      title: `${thread.title}${line.section && line.section !== thread.title ? ` > ${line.section}` : ""}${about ? ` [${about}]` : ""}`,
      text: clip(line.parent ? `${clip(line.parent, 90)} > ${line.text}` : line.text, 900),
      url: thread.url,
      game: "poe1",
      game_version: thread.version,
      retrieved_at: thread.retrieved_at,
      edited_at: thread.posted_at,
      kind: "patch",
      ...(thread.stale ? { flags: ["cached copy, pathofexile.com could not be reached"] } : {}),
    };
  }

  // ----- audit log ------------------------------------------------------------------------------

  /** Which sources each answer used (local file, for auditing mistakes). Never blocks an answer. */
  private log(tool: string, query: string, facts: Fact[]): void {
    if (/^(0|off|false)$/i.test(process.env.POB_KB_LOG ?? "")) return;
    try {
      const file = path.join(cacheDir("knowledge"), "answers.log");
      if (fs.existsSync(file) && fs.statSync(file).size > 2_000_000) fs.renameSync(file, file + ".old");
      const sources = [...new Set(facts.map((f) => `${f.source} ${f.game_version} ${f.url}`))];
      fs.appendFileSync(file, JSON.stringify({ at: this.isoNow(), tool, query, sources }) + "\n");
    } catch { /* logging is optional */ }
  }
}
