/**
 * Create a build (Stage 11): the preference interview, discovering popular
 * builds that fit it (poe.ninja build data), a new build from a real template
 * (a top character's PoB export), the theorycraft mode (patch opportunities from
 * GGG's notes, usage on poe.ninja, a template with the core skill swapped in)
 * and today's cost per stage. Every number comes from PoB or poe.ninja; facts
 * come from the knowledge engine with citations. New builds are always new files.
 */
import fs from "fs";
import path from "path";
import { priceOwn, type OwnGem, type OwnItem, type Priced } from "../economy/sell.js";
import { n } from "../format.js";
import { dpsOf } from "../guideMode.js";
import { Knowledge } from "../knowledge/engine.js";
import { ToolError, type Pob } from "../pob.js";
import { getProfile, PLAYSTYLES, PREFERENCE_CHOICES, preferencesLine, updateProfile, type Preferences } from "../profile.js";
import type { Context } from "../registry.js";
import { currencyRates, ninjaItemLines } from "../trade/ninja.js";
import { formatPatch } from "../tools/knowledge.js";
import { buildFile, currentBuildsDir, decodeBuildCode } from "../tools/session.js";
import { buildsPage, NinjaBuilds, type BuildSearch } from "./ninjaBuilds.js";
import { readTargetCache } from "./targets.js";

export const THEORYCRAFT_LABEL = "THEORYCRAFT, NOT TESTED BY PLAYERS";
let ninja: NinjaBuilds | undefined;
let kb: Knowledge | undefined;
export const ninjaBuilds = (provided?: NinjaBuilds) => (ninja = provided ?? ninja ?? new NinjaBuilds());
const knowledge = () => (kb ??= new Knowledge());
/** Tests: a knowledge engine with canned patch notes. */
export function useKnowledge(k: Pick<Knowledge, "patch" | "fetcher">): void { kb = k as Knowledge; }

const when = (at: number) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const share = (c: number, total: number) => (total > 0 ? `${((c / total) * 100).toFixed(c / total < 0.01 ? 2 : 1)}%` : "?");

/** poe.ninja names the hardcore league "Hardcore <league>"; the trade league name is the same. */
export function ninjaLeague(league: string): string { return league.replace(/^SSF\s+/i, "").trim(); }

// --- interview ------------------------------------------------------------------------
const QUESTIONS: Array<[keyof Preferences | "playMode" | "hardcore", string]> = [
  ["playstyle", `How do you like to fight? any of: ${PLAYSTYLES.join(", ")}`],
  ["content", `Fast map clear or boss killing? ${PREFERENCE_CHOICES.content.join(" / ")}`],
  ["defence", `Tanky or glass cannon? ${PREFERENCE_CHOICES.defence.join(" / ")}`],
  ["buttons", `How many buttons are you happy to press? ${PREFERENCE_CHOICES.buttons.join(" / ")}`],
  ["pace", `Big slow hits or fast small ones? ${PREFERENCE_CHOICES.pace.join(" / ")}`],
  ["novelty", `Something proven or something new? ${PREFERENCE_CHOICES.novelty.join(" / ")}`],
  ["start", `League start or mid-league? ${PREFERENCE_CHOICES.start.join(" / ")}`],
  ["playMode", "Trade, SSF or mixed? trade / ssf / mixed"],
  ["hardcore", "Hardcore? true / false"],
  ["budget", 'Budget for the build (e.g. "5 div"; empty = currency on hand)'],
  ["hours", "Hours of play per week (a number)"],
  ["likes", "Skills, ascendancies or uniques you want (list)"],
  ["exclude", "Skills, ascendancies or mechanics you don't want (list)"],
];

export function interviewText(answers?: Record<string, unknown>): string {
  if (answers && Object.keys(answers).length) {
    const { playMode, hardcore, ...prefs } = answers as Record<string, any>;
    const r = updateProfile({ preferences: prefs as Partial<Preferences>, ...(playMode !== undefined ? { playMode: String(playMode) } : {}), ...(hardcore !== undefined ? { hardcore: hardcore === true || hardcore === "true" } : {}) });
    const ignored = Object.keys(prefs).filter((k) => !QUESTIONS.some(([q]) => q === k));
    return [`Saved in the player profile (shared by every AI app; changed later the same way): ${preferencesLine(r.profile.preferences) || "nothing"}${r.changed.includes("playMode") || r.changed.includes("hardcore") ? ` | ${r.profile.playMode}${r.profile.hardcore ? " hardcore" : ""}` : ""}.`,
      ...(ignored.length ? [`Not a preference (ignored): ${ignored.join(", ")}.`] : []),
      "Next: build_create (no arguments) lists builds that fit; every suggestion says which answers it matches."].join("\n");
  }
  const p = getProfile().profile;
  const cur = (k: string): string => {
    if (k === "playMode") return p.playMode;
    if (k === "hardcore") return String(p.hardcore);
    const v = (p.preferences as any)[k];
    return Array.isArray(v) ? v.join(", ") : v ? String(v) : "";
  };
  return ["Preference interview: ask the player these (a few at a time, in plain words), then save with build_create { answers: { field: value } }. Answers already saved are shown; skip them unless the player wants to change them.",
    ...QUESTIONS.map(([k, q]) => `- ${k}: ${q}${cur(k) ? ` [now: ${cur(k)}]` : ""}`)].join("\n");
}

// --- matching -----------------------------------------------------------------------
const STYLE_WORDS: Record<string, RegExp> = {
  melee: /\bmelee\b/i, ranged: /\b(ranged|bows?|projectiles?)\b/i, spells: /\bspells?\b/i, minions: /\b(minions?|summons?)\b/i,
  totems: /\btotems?\b/i, traps: /\btraps?\b/i, mines: /\bmines?\b/i, dot: /\b(dot|damage over time|ailments?|poison|ignite|bleed)\b/i, hits: /\bhits?\b/i,
};

export function stylesIn(text: string): string[] { return Object.entries(STYLE_WORDS).filter(([, re]) => re.test(text)).map(([k]) => k); }

export interface Option { skill: string; count: number; styles: string[]; matched: string[]; excluded?: string }

/** Main skills of a league filtered and ranked by the interview answers. */
export function rankSkills(skills: Array<{ name: string; count: number }>, total: number, tags: Record<string, { styles: string[]; support?: boolean }>, prefs: Preferences): Option[] {
  const wantStyles = prefs.playstyle;
  const ex = prefs.exclude.map((e) => e.toLowerCase());
  const exStyles = ex.flatMap((e) => stylesIn(e));
  const likes = prefs.likes.map((l) => l.toLowerCase());
  const out: Option[] = [];
  for (const s of skills) {
    const t = tags[s.name];
    if (!t || t.support) continue;
    const opt: Option = { skill: s.name, count: s.count, styles: t.styles, matched: wantStyles.filter((w) => t.styles.includes(w)) };
    if (ex.includes(s.name.toLowerCase())) opt.excluded = "excluded by name";
    else if (t.styles.some((st) => exStyles.includes(st))) opt.excluded = `excluded: ${t.styles.filter((st) => exStyles.includes(st)).join(", ")}`;
    if (likes.includes(s.name.toLowerCase())) opt.matched.unshift("liked");
    out.push(opt);
  }
  const floor = Math.max(10, total * 0.001);
  const fits = out.filter((o) => !o.excluded && (!wantStyles.length || o.matched.length || o.matched.includes("liked")) && o.count >= (prefs.novelty === "new" ? floor : 1));
  const rank = (o: Option) => (o.matched.includes("liked") ? 1e9 : 0) + o.matched.length * 1e6 + (prefs.novelty === "new" ? 1e6 / o.count : o.count);
  return fits.sort((a, b) => rank(b) - rank(a));
}

// --- unique prices (poe.ninja) --------------------------------------------------------
/** poe.ninja's item counts include plain item kinds ("Rare Boots", "Normal Flask"). */
const GENERIC = /^(Normal|Magic|Rare) /;
const UNIQUE_TYPES = ["UniqueWeapon", "UniqueArmour", "UniqueAccessory", "UniqueFlask", "UniqueJewel"];
async function uniquePrice(league: string, name: string): Promise<number | undefined> {
  let best: number | undefined;
  for (const type of UNIQUE_TYPES) {
    const lines = await ninjaItemLines(league, type).catch(() => []);
    for (const l of lines) if (l.name === name && !(l.links && l.links >= 5) && (best === undefined || l.chaosValue < best)) best = l.chaosValue;
    if (best !== undefined) return best;
  }
  return best;
}

async function gemStyles(pob: Pob, names: string[]): Promise<Record<string, { styles: string[]; support?: boolean }>> {
  const side = await pob.sideLink();
  return (await side.call("create_gem_tags", { names })).result ?? {};
}

function costTier(chaos: number, divine?: number): string {
  if (!divine) return `${n(Math.round(chaos))}c`;
  const d = chaos / divine;
  return `${d >= 1 ? `${d.toFixed(1)} div` : `${n(Math.round(chaos))}c`} (${d < 1 ? "cheap" : d <= 10 ? "medium" : "expensive"}; advisor tiers: < 1 div, 1-10 div, > 10 div)`;
}

// --- discover ----------------------------------------------------------------------------
export async function discoverText(ctx: Context, a: { league: string; leagueNote?: string; limit?: number }): Promise<string> {
  const profile = getProfile().profile;
  const prefs = profile.preferences;
  const nb = ninjaBuilds();
  nb.beginCall();
  const league = ninjaLeague(a.league);
  const all = await nb.search(league);
  const skills = all.counts.get("skills") ?? [];
  if (!skills.length) return `poe.ninja has no main-skill data for ${all.league} yet (${n(all.total)} characters). Try again later, or name a skill: build_create { skill }.`;
  const tags = await gemStyles(ctx.pob, skills.map((s) => s.name));
  const ranked = rankSkills(skills, all.total, tags, prefs);
  const limit = Math.min(Math.max(a.limit ?? 3, 1), 5);
  const rates = await currencyRates(league).catch(() => new Map<string, number>());
  const divine = rates.get("Divine Orb");
  const L = [`Builds on poe.ninja for ${all.league}: ${n(all.total)} characters, snapshot read ${when(all.at)}${all.stale ? " (poe.ninja did not answer: older copy)" : ""}. ${buildsPage(all)}`];
  const asked = preferencesLine(prefs);
  L.push(asked ? `Your answers: ${asked}.` : "No interview answers yet (build_create { interview: true }); ranked by popularity only.");
  const classes = all.counts.get("class") ?? [];
  if (classes.length && classes.every((c) => /^(Duelist|Marauder|Ranger|Scion|Shadow|Templar|Witch)$/.test(c.name) || c.count < all.total * 0.02))
    L.push("Most characters have not chosen an ascendancy yet (early league): classes below are mostly base classes.");
  const unchecked = (["buttons", "pace", "hours", "content"] as const).filter((k) => prefs[k]).map((k) => k);
  for (const [i, o] of ranked.slice(0, limit).entries()) {
    let detail = "";
    try {
      const s = await nb.search(league, { skills: o.skill });
      const cls = (s.counts.get("class") ?? []).slice(0, 3).map((c) => `${c.name} ${share(c.count, s.total)}`).join(", ");
      const common = (s.counts.get("items") ?? []).filter((it) => it.count >= s.total * 0.2 && !GENERIC.test(it.name)).slice(0, 5);
      let sum = 0, known = 0; const priced: string[] = [];
      for (const it of common) {
        const c = await uniquePrice(league, it.name);
        if (c !== undefined) { sum += c; known++; }
        priced.push(`${it.name} ${share(it.count, s.total)}${c !== undefined ? ` ~${n(Math.round(c))}c` : " (no price)"}`);
      }
      const cost = profile.playMode === "ssf" ? "[SSF] these must drop or be farmed"
        : known ? `Typical unique cost today: ${costTier(sum, divine)}${known < common.length ? " (some without a price)" : ""}` : "No poe.ninja price for these uniques yet";
      detail = `\n   Classes: ${cls || "?"}\n   Common uniques (used by 20%+): ${priced.join(", ") || "none"}${common.length ? `\n   ${cost}` : ""}`;
    } catch (e) {
      detail = `\n   (details not read: ${e instanceof Error ? e.message : String(e)})`;
    }
    L.push(`${i + 1}. ${o.skill}: ${n(o.count)} characters (${share(o.count, all.total)})${detail}`,
      `   Matches: ${o.matched.length ? o.matched.join(", ") : "-"} | style (PoB gem tags): ${o.styles.join(", ") || "?"}${unchecked.length ? ` | not checked (no data): ${unchecked.join(", ")}` : ""}`,
      `   Make it: build_create { skill: "${o.skill}" } (add class to pick an ascendancy)`);
  }
  if (!ranked.length) L.push("Nothing on poe.ninja fits the answers; loosen them or use the theorycraft mode (build_create { theorycraft }).");
  L.push(`Prices: poe.ninja ${league}, today. Difficulty and league-start friendliness are not measured by any source we use: say so.${a.leagueNote ? ` ${a.leagueNote}` : ""}`);
  return L.join("\n");
}

// --- a new build from a template ---------------------------------------------------------
function escapeXml(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

export function withNotes(xml: string, note: string): string {
  const esc = escapeXml(note);
  if (/<Notes>[\s\S]*?<\/Notes>/.test(xml)) return xml.replace(/<Notes>([\s\S]*?)<\/Notes>/, (_m, old) => `<Notes>${esc}\n\n${old}</Notes>`);
  if (/<Notes\s*\/>/.test(xml)) return xml.replace(/<Notes\s*\/>/, `<Notes>${esc}</Notes>`);
  return xml.replace(/<\/PathOfBuilding>\s*$/, `<Notes>${esc}</Notes>\n</PathOfBuilding>`);
}

export function newBuildFile(dir: string, base: string): string {
  const clean = base.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  let file = buildFile(dir, clean);
  for (let k = 2; fs.existsSync(file); k++) file = buildFile(dir, `${clean} (${k})`);
  return file;
}

interface Candidate { link: string; className: string; level: number; xml: string; stats: any; mainSkill?: string; uniqueCost: number; unpriced: number }

const scoreOf = (c: Candidate, prefs: Preferences, hardcore: boolean) => {
  const d = Math.log10(Math.max(dpsOf(c.stats), 1)), e = Math.log10(Math.max(c.stats.TotalEHP ?? 1, 1));
  return hardcore || prefs.defence === "tanky" ? d + 2 * e : prefs.defence === "glass" ? 2 * d + e : d + e;
};

/** Makes the socket group with the skill the main skill (a template's own main skill may be another). */
async function focusSkill(side: Awaited<ReturnType<Pob["sideLink"]>>, skill: string): Promise<void> {
  const sum = (await side.call("summary").catch(() => null))?.summary;
  const g = (sum?.groups ?? []).find((x: any) => (x.gems ?? []).some((gem: any) => gem.name === skill && !gem.support));
  if (g && g.index !== sum?.mainSocketGroup) await side.call("set_main_selection", { mainSocketGroup: g.index }).catch(() => undefined);
}

/** Loads a template, optionally swaps in the theorycraft skill, saves it as a NEW build and reports it. */
export async function createText(ctx: Context, a: { league: string; leagueNote?: string; skill: string; className?: string; theorycraft?: string }): Promise<string> {
  const profile = getProfile().profile;
  const prefs = profile.preferences;
  const nb = ninjaBuilds();
  nb.beginCall();
  const league = ninjaLeague(a.league);
  const side = await ctx.pob.sideLink();
  const known = (await side.call("create_gem_tags", { names: [a.skill] })).result ?? {};
  const mine = known[a.skill] ?? Object.entries(known).find(([k]) => k.toLowerCase() === a.skill.toLowerCase())?.[1];
  if (!mine) throw new ToolError(`PoB has no gem named "${a.skill}": it cannot simulate it (check the exact name with kb_lookup; a gem from a new patch may not be in PoB's data yet).`);
  const L: string[] = [];
  let s: BuildSearch = await nb.search(league, { skills: a.skill, class: a.className });
  let swapFrom: string | undefined;
  if (!s.characters.length) {
    if (!a.theorycraft) throw new ToolError(`No character on poe.ninja (${s.league}) uses ${a.skill}${a.className ? ` as ${a.className}` : ""}. For an untested idea use build_create { theorycraft: "...", skill: "${a.skill}" }.`);
    // Nobody plays it: the nearest real build = the most played skill with the most of the same styles.
    const all = await nb.search(league, a.className ? { class: a.className } : {});
    const pool = (all.counts.get("skills") ?? []).slice(0, 40);
    const tags = await gemStyles(ctx.pob, pool.map((x) => x.name));
    const near = pool.map((x) => ({ ...x, same: (tags[x.name]?.styles ?? []).filter((st) => mine.styles.includes(st)).length }))
      .filter((x) => x.same > 0 && !tags[x.name]?.support).sort((x, y) => y.same - x.same || y.count - x.count)[0];
    if (!near) throw new ToolError(`No played build shares a style (${mine.styles.join(", ")}) with ${a.skill}; give core pieces another way (a guide: guide { source }).`);
    swapFrom = near.name;
    s = await nb.search(league, { skills: near.name, class: a.className });
    L.push(`Nobody on poe.ninja uses ${a.skill} yet. Template: the nearest real build, ${near.name} (${mine.styles.filter((st: string) => (tags[near.name]?.styles ?? []).includes(st as string)).join(", ")}), with its main skill replaced by ${a.skill}.`);
  }

  // Up to three top characters of different classes, each loaded and simulated in PoB.
  const picks: typeof s.characters = [];
  for (const c of s.characters) {
    if (picks.length >= 3) break;
    if (!picks.some((p) => p.className && p.className === c.className)) picks.push(c);
  }
  const rates = await currencyRates(league).catch(() => new Map<string, number>());
  const cands: Candidate[] = [];
  const problems: string[] = [];
  for (const p of picks) {
    try {
      const ch = await nb.character(league, p.account, p.name);
      const xml = decodeBuildCode(ch.code);
      await side.call("load_build_xml", { xml, name: "Template" });
      await focusSkill(side, swapFrom ?? a.skill);
      const ks = await side.call("key_stats");
      const own = (await side.call("economy_items")).result as { items: OwnItem[]; gems: OwnGem[] };
      const priced = (await priceOwn(league, { items: own.items.filter((i) => i.rarity === "UNIQUE" && i.slot), gems: [] }, { minChaos: 0 })).priced;
      cands.push({ link: ch.link, className: ks.ascendancy && ks.ascendancy !== "None" ? ks.ascendancy : ks.className, level: ks.level, xml, stats: ks.stats, mainSkill: ks.mainSkill,
        uniqueCost: priced.reduce((t, x) => t + (x.chaos ?? 0), 0), unpriced: priced.filter((x) => x.chaos === undefined).length });
    } catch (e) { problems.push(e instanceof Error ? e.message : String(e)); }
  }
  if (!cands.length) throw new ToolError(`Could not load a template from poe.ninja: ${problems.join("; ") || "no characters"}.`);
  const best = cands.slice().sort((x, y) => scoreOf(y, prefs, profile.hardcore) - scoreOf(x, prefs, profile.hardcore))[0];

  // The chosen template again in the side engine; swap the skill when theorycrafting.
  await side.call("load_build_xml", { xml: best.xml, name: "Template" });
  await focusSkill(side, swapFrom ?? a.skill);
  let swapNote = "";
  if (swapFrom) {
    const sum = (await side.call("summary")).summary ?? {};
    const g = (sum.groups ?? []).find((x: any) => (x.gems ?? []).some((gem: any) => gem.name === swapFrom)) as any;
    const gi = g ? (g.gems as any[]).findIndex((gem) => gem.name === swapFrom) + 1 : 0;
    if (!g || !gi) throw new ToolError(`The template's ${swapFrom} gem was not found to replace.`);
    const r = await side.call("edit", { ops: [{ op: "remove_gem", group: g.index, gem: gi }, { op: "add_gem", group: g.index, name: a.skill, level: 20, quality: 20 }] });
    if (r.failed?.length || r.failed > 0) swapNote = ` (swap problems: ${JSON.stringify(r.results).slice(0, 200)})`;
    await side.call("set_main_selection", { mainSocketGroup: g.index }).catch(() => undefined);
  }
  const ks = await side.call("key_stats");
  const um = (await side.call("create_unmodelled")).result as { items: any[]; nodes: any[]; gems: any[] };
  const xml0 = (await side.call("export_build_xml")).xml as string;
  const label = a.theorycraft ? THEORYCRAFT_LABEL : "Template from a real character";
  const matched = [...prefs.playstyle.filter((p) => mine.styles.includes(p)), ...(prefs.likes.some((l) => l.toLowerCase() === a.skill.toLowerCase()) ? ["liked"] : [])];
  const unmod = [...um.gems.map((g) => `gem ${g.name}`), ...um.items.map((i) => `${i.slot}: "${i.line}"`), ...um.nodes.map((nd) => `passive ${nd.name}${nd.partly ? " (partly)" : ""}`)];
  const note = [
    `${label}. Created by PoB Agent Edition on ${when(Date.now())}.`,
    `Template: ${best.className} level ${best.level} from poe.ninja ${s.league} (${best.link})${swapFrom ? `, main skill ${swapFrom} replaced by ${a.skill}` : ""}.`,
    a.theorycraft ? `Idea: ${a.theorycraft}. Nobody has tested this; numbers are PoB's.` : "",
    `Matches your answers: ${matched.join(", ") || "-"}.`,
    unmod.length ? `PoB does not model: ${unmod.slice(0, 8).join("; ")}.` : "PoB reads every line of this build.",
  ].filter(Boolean).join("\n");
  const dir = await currentBuildsDir(ctx.pob);
  const file = newBuildFile(dir, `${a.theorycraft ? "Theorycraft" : "New build"} - ${a.skill} ${best.className}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, withNotes(xml0, note), "utf8");
  const divine = rates.get("Divine Orb");
  const stat = (c: { stats: any }) => `DPS ${n(Math.round(dpsOf(c.stats)))}, EHP ${n(Math.round(c.stats.TotalEHP ?? 0))}, life ${n(Math.round(c.stats.Life ?? 0))}, phys max hit ${n(Math.round(c.stats.PhysicalMaximumHitTaken ?? 0))}`;
  L.push(`${a.theorycraft ? `${THEORYCRAFT_LABEL}. ` : ""}Saved a NEW build "${path.basename(file, ".xml")}" (${file}); your builds were not touched.`,
    `Candidates (top poe.ninja characters using ${swapFrom ?? a.skill}, simulated in PoB with their own config):`,
    ...cands.map((c) => `- ${c === best ? "[chosen] " : ""}${c.className} lvl ${c.level}${c.mainSkill && c.mainSkill !== (swapFrom ?? a.skill) ? ` (PoB main skill: ${c.mainSkill})` : ""}: ${stat(c)}; uniques ~${costTier(c.uniqueCost, divine)}${c.unpriced ? ` + ${c.unpriced} without a price` : ""}`),
    `Chosen by your answers (${profile.hardcore || prefs.defence === "tanky" ? "defence first" : prefs.defence === "glass" ? "damage first" : "balanced"}).${swapFrom ? ` After the swap: ${stat(ks as any)}${swapNote}.` : ""}`,
    unmod.length ? `PoB does NOT model (its numbers leave these out): ${unmod.join("; ")}.` : "PoB reads every item line, passive and gem of the build.",
    `Config assumptions: ${ks.assumptions}.`,
    ...problems.map((p) => `Skipped a candidate: ${p}`),
    `Next: open_build "${path.basename(file, ".xml")}" (ask first if the open build has unsaved changes), then optimise { goal } to tune tree, gems and flasks, build_create { targets: true } for every rare (close-enough trade search + craft), build_create { prices: true } for the cost per stage, guide { guide: "${path.basename(file, ".xml")}", levelling: "plan" } for the campaign. Compare your character with it: guide { guide: "${path.basename(file, ".xml")}" }.`);
  if (a.leagueNote) L.push(a.leagueNote);
  return L.join("\n");
}

// --- theorycraft ----------------------------------------------------------------------------
export async function theorycraftText(ctx: Context, a: { league: string; leagueNote?: string; topic: string; limit?: number }): Promise<string> {
  const engine = knowledge();
  engine.fetcher.beginCall();
  const parts = a.topic.split(/[,;+]/).map((x) => x.trim()).filter(Boolean);
  const r = await engine.patch(parts.length > 1 ? { names: parts } : { filter: parts[0] ?? a.topic });
  const L = [`${THEORYCRAFT_LABEL}: ideas from the official patch notes, not builds anyone has proven.`, formatPatch(r, parts.length > 1 ? `naming ${parts.join(", ")}` : `matching "${a.topic}"`, 15)];
  const side = await ctx.pob.sideLink();
  const named = (await side.call("create_find_names", { texts: r.facts.map((f) => f.text) })).result as { gems: string[]; uniques: string[] };
  const topicStyles = stylesIn(a.topic);
  const tags = await gemStyles(ctx.pob, named.gems);
  const active = named.gems.filter((g) => tags[g] && !tags[g].support);
  const nb = ninjaBuilds();
  nb.beginCall();
  const league = ninjaLeague(a.league);
  let usage = "";
  try {
    const all = await nb.search(league);
    const main = new Map((all.counts.get("skills") ?? []).map((x) => [x.name, x.count]));
    const any = new Map((all.counts.get("allgems") ?? []).map((x) => [x.name, x.count]));
    const items = new Map((all.counts.get("items") ?? []).map((x) => [x.name, x.count]));
    const row = (name: string, count: number | undefined) => `${name} ${count ? share(count, all.total) : "0 (nobody yet)"}`;
    usage = [`Usage on poe.ninja ${all.league} (${n(all.total)} characters, ${when(all.at)}); under 1% = few players use it yet:`,
      active.length ? `- skills named in these lines (as main skill / in any gem slot): ${active.map((g) => `${row(g, main.get(g))} / ${any.get(g) ? share(any.get(g)!, all.total) : "0"}`).join("; ")}` : "- no skill gem is named in these lines",
      named.gems.length > active.length ? `- supports: ${named.gems.filter((g) => tags[g]?.support).map((g) => row(g, any.get(g) ?? any.get(`${g} Support`))).join("; ")}` : "",
      named.uniques.length ? `- uniques: ${named.uniques.map((u) => row(u, items.get(u))).join("; ")}` : ""].filter(Boolean).join("\n");
  } catch (e) { usage = `poe.ninja usage not read: ${e instanceof Error ? e.message : String(e)}`; }
  L.push("", usage);
  const fit = active.filter((g) => !topicStyles.length || tags[g].styles.some((st) => topicStyles.includes(st)));
  if (fit.length) L.push("", "Build one (a real template, the skill swapped in when nobody plays it, saved as a NEW build labelled theorycraft):",
    ...fit.slice(0, Math.min(a.limit ?? 3, 5)).map((g) => `- build_create { theorycraft: "${a.topic}", skill: "${g}" } (${tags[g].styles.join(", ")})`));
  else L.push("", "No skill gem in these lines fits the topic: pick core pieces yourself (a skill, uniques, an ascendancy) and call build_create { theorycraft: \"<idea>\", skill }.");
  L.push("Mechanics: explain them from kb_lookup (cited), never from memory; numbers only from PoB after the build is made.");
  if (a.leagueNote) L.push(a.leagueNote);
  return L.filter((x) => x !== undefined).join("\n");
}

// --- cost per stage --------------------------------------------------------------------------
export async function pricesText(ctx: Context, a: { league: string; leagueNote?: string }): Promise<string> {
  const link = await ctx.pob.link();
  const league = ninjaLeague(a.league);
  const sets = (await link.call("create_sets")).result as Array<{ id: number; title: string; active?: boolean; items: OwnItem[] }>;
  const own = (await link.call("economy_items")).result as { items: OwnItem[]; gems: OwnGem[] };
  const ks = await link.call("key_stats").catch(() => null);
  const build = String(ks?.name ?? "build");
  const cache = readTargetCache(build);
  const fresh = cache && cache.league === a.league && Date.now() - cache.at < 86_400_000 ? cache : undefined;
  const rates = await currencyRates(league).catch(() => new Map<string, number>());
  const divine = rates.get("Divine Orb");
  const money = (c: number) => (divine && c >= divine ? `${(c / divine).toFixed(1)} div (${n(Math.round(c))}c)` : `${n(Math.round(c))}c`);
  const L = [`Cost per stage of ${build} (item sets = stages), league ${league}, checked ${when(Date.now())}. Uniques and gems: poe.ninja (at most 2 hours old). Rares: the cheapest close-enough instant-buyout listing from build_create { targets: true }${fresh ? ` (searched ${when(fresh.at)})` : " (not searched yet)"}.`];
  if (getProfile().profile.playMode === "ssf") L.push("SSF: you cannot buy these; the prices only show what is rare or valuable to find.");
  const notes: string[] = [];
  for (const set of sets) {
    const items = set.items.filter((i) => !/^Flask|^Jewel/.test(i.slot ?? "") || i.rarity === "UNIQUE");
    const { priced, notes: nn } = await priceOwn(league, { items: items.filter((i) => i.rarity === "UNIQUE"), gems: [] }, { minChaos: 0 });
    notes.push(...nn);
    let total = 0;
    const parts: string[] = [], missing: string[] = [];
    for (const p of priced as Priced[]) { if (p.chaos !== undefined) { total += p.chaos; parts.push(`${p.name} ${money(p.chaos)}`); } else missing.push(p.name); }
    for (const r of items.filter((i) => i.rarity === "RARE" && i.slot && !/^Flask/.test(i.slot))) {
      const hit = set.active ? fresh?.slots[r.slot!] : undefined;
      if (hit) { total += hit.chaos; parts.push(`${r.slot} rare ~${money(hit.chaos)} (${Math.round(hit.closeness * 100)}% of the target)`); }
      else missing.push(`${r.slot} rare`);
    }
    L.push("", `${set.title}${set.active ? " (active)" : ""}: ~${money(total)}${missing.length ? ` + not priced: ${missing.join(", ")}` : ""}`, ...(parts.length ? [`   ${parts.join(" | ")}`] : []));
  }
  const gems = await priceOwn(league, { items: [], gems: own.gems.filter((g) => g.enabled !== false) }, { minChaos: 1 });
  const gemTotal = gems.priced.reduce((t, g) => t + (g.chaos ?? 0), 0);
  if (gems.priced.length) L.push("", `Gems worth 1c+ (shared by every stage): ~${money(gemTotal)}: ${gems.priced.filter((g) => g.chaos !== undefined).slice(0, 10).map((g) => `${g.name} ${money(g.chaos!)}`).join(", ")}`);
  if (sets.some((s) => !s.active) && fresh) L.push("Rares are searched for the active item set only (switch the set in PoB and run targets again for another stage).");
  if (!fresh) L.push("Rares: run build_create { targets: true } first; it also finds close-enough items to buy.");
  L.push(...[...new Set(notes)].map((x) => `- ${x}`));
  if (a.leagueNote) L.push(a.leagueNote);
  return L.join("\n");
}
