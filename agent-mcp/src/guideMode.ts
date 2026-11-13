/**
 * Guide mode (Stage 3): import a build guide, compare the open build with a
 * guide stage, rank the next steps toward it.
 *
 * Guides come from a PoB code or a build-site link. The download addresses
 * are the ones Path of Building uses itself (src/Modules/BuildSiteTools.lua).
 * Every number comes from PoB: the Lua side (Agent/Handlers/Guide.lua)
 * simulates each gap in the player's build and puts the build back.
 */
import fs from "fs";
import path from "path";
import { n } from "./format.js";
import { cacheDir, USER_AGENT } from "./paths.js";
import { ToolError } from "./pob.js";
import { parseBudgetText } from "./economy/budget.js";
import { NINJA_ITEM_TYPES, ninjaItemLines } from "./trade/ninja.js";

// --- sources -------------------------------------------------------------------------
const SITES: Array<{ name: string; re: RegExp; raw: (id: string) => string }> = [
  { name: "pobb.in", re: /^https?:\/\/pobb\.in\/(?:pob\/)?([\w-]+)\/?(?:[?#].*)?$/i, raw: (id) => `https://pobb.in/pob/${id}` },
  { name: "poe.ninja", re: /^https?:\/\/(?:www\.)?poe\.ninja\/(?:poe1\/)?pob\/(?:raw\/)?(\w+)\/?(?:[?#].*)?$/i, raw: (id) => `https://poe.ninja/poe1/pob/raw/${id}` },
  { name: "pastebin", re: /^https?:\/\/(?:www\.)?pastebin\.com\/(?:raw\/)?(\w+)\/?(?:[?#].*)?$/i, raw: (id) => `https://pastebin.com/raw/${id}` },
  { name: "maxroll", re: /^https?:\/\/maxroll\.gg\/poe\/pob\/([\w-]+)\/?(?:[?#].*)?$/i, raw: (id) => `https://maxroll.gg/poe/api/pob/${id}` },
  { name: "pob.codes", re: /^https?:\/\/pob\.codes\/b\/([\w-]+)\/?(?:[?#].*)?$/i, raw: (id) => `https://api.pob.codes/${id}/raw` },
  { name: "rentry", re: /^https?:\/\/rentry\.co\/(\w+)\/?(?:[?#].*)?$/i, raw: (id) => `https://rentry.co/paste/${id}/raw` },
  { name: "poedb", re: /^https?:\/\/poedb\.tw\/pob\/([\w-]+)\/?(?:[?#].*)?$/i, raw: (id) => `https://poedb.tw/pob/${id}/raw` },
];

/** The address to download a build code from, or null when the text is not a link. */
export function rawUrl(link: string): string | null {
  const text = link.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  if (/mobalytics\.gg/i.test(text)) {
    throw new ToolError("Mobalytics pages are built by JavaScript and hold no PoB code to download. Ask the player to open the guide, use its PoB link (pobb.in, poe.ninja, pastebin) or copy its PoB code, and paste that.");
  }
  for (const site of SITES) {
    const m = site.re.exec(text);
    if (m) return site.raw(m[1]);
  }
  throw new ToolError(`Unknown build site: ${text}. Supported: ${SITES.map((s) => s.name).join(", ")}, or paste the PoB code itself.`);
}

/** One "Stage: link" (or a bare link/code) per line. Codes have no spaces, so a long line without ": " is a code. */
export function parseSources(source: string): Array<{ stage?: string; ref: string }> {
  const lines = source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines[0].startsWith("<")) return [{ ref: source.trim() }];
  return lines.map((line) => {
    const m = /^(.{1,60}?)\s*[:=]\s+(\S+)$/.exec(line) ?? /^(.{1,60}?)\s*[:=]\s*(https?:\/\/\S+)$/.exec(line);
    return m && !/^https?$/i.test(m[1]) ? { stage: m[1].trim(), ref: m[2] } : { ref: line };
  });
}

export async function download(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new ToolError(`Could not download ${url} (${e instanceof Error ? e.message : String(e)}). Ask the player to paste the PoB code instead.`);
  }
  if (!response.ok) throw new ToolError(`${url} answered ${response.status}. Check the link, or paste the PoB code instead.`);
  return (await response.text()).trim();
}

// --- merging several stage builds into one guide build -------------------------------
const block = (xml: string, tag: string) => new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, "g");
const all = (xml: string, tag: string) => xml.match(block(xml, tag)) ?? [];
const attr = (el: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(el)?.[1];
const setAttr = (el: string, name: string, value: string) => {
  const esc = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const re = new RegExp(`(<\\w+\\b[^>]*?)\\s${name}="[^"]*"`);
  return re.test(el.slice(0, el.indexOf(">") + 1)) ? el.replace(re, `$1 ${name}="${esc}"`) : el.replace(/^<(\w+)/, `<$1 ${name}="${esc}"`);
};
const section = (xml: string, tag: string) => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
const xmlText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Part { stage: string; xml: string }

/** Sets of one kind (SkillSet, ItemSet, ConfigSet); a build without sets has one implicit set. */
function setsOf(xml: string, container: string, setTag: string, childTag: string): string[] {
  const sets = all(xml, setTag);
  if (sets.length) return sets;
  const body = section(xml, container)?.[1] ?? "";
  const kids = all(body, childTag).filter((c) => !c.startsWith(`<${setTag}`));
  return [`<${setTag} id="1" title="Default">${kids.join("")}</${setTag}>`];
}

/**
 * Several stage builds -> one build whose loadouts are the stages: every tree
 * spec gets an item, skill and config set of the same title (PoB's Loadouts
 * pair them by title). Item ids are renumbered so the stages never clash.
 */
export function mergeStages(parts: Part[]): string {
  const specs: string[] = [], items: string[] = [], skillSets: string[] = [], itemSets: string[] = [], configSets: string[] = [];
  const notes: string[] = [];
  let itemOffset = 0, setId = 0;
  for (const part of parts) {
    const partItems = all(section(part.xml, "Items")?.[1] ?? "", "Item");
    const maxId = Math.max(0, ...partItems.map((i) => Number(attr(i, "id")) || 0));
    const shift = (el: string) => el.replace(/\bitemId="(\d+)"/g, (_, id) => `itemId="${Number(id) > 0 ? Number(id) + itemOffset : 0}"`);
    for (const it of partItems) items.push(setAttr(it, "id", String((Number(attr(it, "id")) || 0) + itemOffset)));
    const partSpecs = all(section(part.xml, "Tree")?.[1] ?? "", "Spec");
    const pSkills = setsOf(part.xml, "Skills", "SkillSet", "Skill");
    const pItems = setsOf(part.xml, "Items", "ItemSet", "Slot");
    const pConfig = setsOf(part.xml, "Config", "ConfigSet", "Input");
    const pick = (sets: string[], title: string | undefined) => sets.find((s) => attr(s, "title") === title) ?? sets[0];
    for (const spec of partSpecs) {
      const old = attr(spec, "title");
      const title = partSpecs.length === 1 ? part.stage : `${part.stage} - ${old ?? "Default"}`;
      specs.push(shift(setAttr(spec, "title", title)));
      setId++;
      skillSets.push(setAttr(setAttr(pick(pSkills, old), "id", String(setId)), "title", title));
      itemSets.push(shift(setAttr(setAttr(pick(pItems, old), "id", String(setId)), "title", title)));
      configSets.push(setAttr(setAttr(pick(pConfig, old), "id", String(setId)), "title", title));
    }
    const note = section(part.xml, "Notes")?.[1]?.trim();
    if (note) notes.push(`=== ${xmlText(part.stage)} ===\n${note}`);
    itemOffset += maxId;
  }
  let xml = parts[0].xml;
  const open = (tag: string, active: string) => {
    const m = new RegExp(`<${tag}\\b[^>]*>`).exec(xml)?.[0] ?? `<${tag}>`;
    return setAttr(m.replace(/\/>$/, ">"), active, "1");
  };
  const replace = (tag: string, active: string, body: string) => {
    const re = new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`);
    const el = `${open(tag, active)}\n${body}\n</${tag}>`;
    xml = re.test(xml) ? xml.replace(re, () => el) : xml.replace("</PathOfBuilding>", () => `${el}\n</PathOfBuilding>`);
  };
  replace("Tree", "activeSpec", specs.join("\n"));
  replace("Skills", "activeSkillSet", skillSets.join("\n"));
  replace("Items", "activeItemSet", [...items, ...itemSets].join("\n"));
  replace("Config", "activeConfigSet", configSets.join("\n"));
  replace("Notes", "x-unused", notes.join("\n\n"));
  return xml.replace(/<Notes x-unused="1">/, "<Notes>");
}

/** Adds where the guide came from at the top of its notes. */
export function withSourceNote(xml: string, sources: string[]): string {
  const line = xmlText(`Guide imported by PoB Agent Edition on ${new Date().toISOString().slice(0, 10)} from: ${sources.join(", ")}`);
  if (/<Notes\b[^>]*\/>/.test(xml)) return xml.replace(/<Notes\b[^>]*\/>/, () => `<Notes>${line}</Notes>`);
  if (/<Notes\b[^>]*>/.test(xml)) return xml.replace(/<Notes\b[^>]*>/, (m) => `${m}${line}\n\n`);
  return xml.replace("</PathOfBuilding>", () => `<Notes>${line}</Notes>\n</PathOfBuilding>`);
}

// --- remembered state (per player build) ------------------------------------------------
export interface GuideChoice { guide: string; stage?: string; accept: string[] }
interface StateFile { builds: Record<string, GuideChoice>; last?: string }

const stateFile = () => path.join(cacheDir("guide"), "state.json");

export function readState(): StateFile {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return { builds: data.builds ?? {}, last: data.last };
  } catch {
    return { builds: {} };
  }
}

export function writeState(state: StateFile): void {
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 1), "utf8");
}

/** The guide card the Overview tab shows (Agent/Handlers + OverviewTab read this file). */
export function writeCard(card: unknown): void {
  const file = path.join(cacheDir("guide"), "card.json");
  fs.writeFileSync(file + ".tmp", JSON.stringify(card), "utf8");
  fs.renameSync(file + ".tmp", file);
}

// --- stages (detection itself runs in PoB: Agent/Handlers/Guide.lua guide_detect) -------------
export interface LightStage {
  index: number; title: string; points: number; nodes: number[]; items: Record<string, string>; gems: string[];
  skills?: Array<{ name: string; req?: number }>; levelling?: boolean;
}

// --- formatting ---------------------------------------------------------------------------
export interface Gain { dps: number; dpsPct: number; ehp: number; ehpPct: number; life: number; res?: Record<string, number>; failed?: string[]; error?: string; rollbackProblem?: string }

export const dpsOf = (s: any): number => (s?.FullDPS > 0 ? s.FullDPS : s?.CombinedDPS ?? s?.TotalDPS ?? 0);

const sign = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

export function gainText(g: Gain | undefined | null): string {
  if (!g) return "not simulated";
  if (g.error) return `simulation failed: ${g.error}`;
  const parts = [`DPS ${sign(g.dpsPct)}%`, `EHP ${sign(g.ehpPct)}%`];
  if (Math.abs(g.life) >= 1) parts.push(`life ${sign(g.life, 0)}`);
  const res = Object.entries(g.res ?? {}).filter(([, v]) => Math.abs(v) >= 1).map(([k, v]) => `${k} res ${sign(v, 0)}`);
  if (res.length) parts.push(res.join(", "));
  if (g.failed?.length) parts.push(`(partly failed: ${g.failed[0]})`);
  return parts.join(", ");
}

export function itemName(name?: string, base?: string, rarity?: string): string {
  if (!name) return "(empty)";
  const generic = /^New Item\b/i.test(name) || name === base;
  const r = String(rarity ?? "").toLowerCase();
  if (generic) return `${r || "rare"} ${base ?? name.replace(/^New Item,?\s*/i, "")}`.trim();
  const shortName = name.split(",")[0].trim();
  if (r === "unique") return `${shortName} (unique)`;
  if (!r || r === "magic" || r === "normal" || !base || shortName.includes(base)) return shortName;
  return `${shortName}, ${r} ${base}`;
}

/** Value used for ranking: DPS and EHP in percent; hardcore weighs defence twice. */
export function value(g: Gain | undefined | null, hardcore: boolean): number {
  if (!g || g.error) return 0;
  return g.dpsPct + (hardcore ? 2 : 1) * g.ehpPct;
}

export function headline(me: any, guide: any): string[] {
  const row = (label: string, a: number, b: number) => `${label}: you ${n(a)} | guide ${n(b)}${b > 0 ? ` (${Math.round((a / b) * 100)}%)` : ""}`;
  const lines = [row("DPS", dpsOf(me), dpsOf(guide)), row("EHP", me.TotalEHP ?? 0, guide.TotalEHP ?? 0), row("Life", me.Life ?? 0, guide.Life ?? 0)];
  if ((me.EnergyShield ?? 0) + (guide.EnergyShield ?? 0) > 50) lines.push(row("Energy shield", me.EnergyShield ?? 0, guide.EnergyShield ?? 0));
  const weakest = (s: any) => Math.min(...["Physical", "Fire", "Cold", "Lightning", "Chaos"].map((k) => s[`${k}MaximumHitTaken`] ?? Infinity));
  lines.push(row("Weakest max hit", weakest(me), weakest(guide)));
  lines.push(`Resists (fire/cold/lightning/chaos): you ${["Fire", "Cold", "Lightning", "Chaos"].map((k) => n(me[`${k}Resist`])).join("/")} | guide ${["Fire", "Cold", "Lightning", "Chaos"].map((k) => n(guide[`${k}Resist`])).join("/")}`);
  return lines;
}

// --- prices (poe.ninja, cached 30 minutes; only what a ranking needs) --------------------
const NINJA_TYPES = NINJA_ITEM_TYPES;
const ninjaLines = (league: string, type: string): Promise<any[]> => ninjaItemLines(league, type);

/** Cheapest poe.ninja price in chaos for a unique (exact name) or a gem; undefined when not listed. */
export async function ninjaPrice(league: string, name: string, kind: "unique" | "gem", slot = ""): Promise<{ chaos: number; name: string } | undefined> {
  const want = name.toLowerCase();
  const types: string[] = kind === "gem" ? ["SkillGem"]
    : /^Flask/.test(slot) ? ["UniqueFlask"] : /^Jewel/.test(slot) ? ["UniqueJewel"]
    : /Amulet|Ring|Belt/.test(slot) ? ["UniqueAccessory"] : /Weapon/.test(slot) ? ["UniqueWeapon", "UniqueArmour"] : ["UniqueArmour"];
  for (const type of types.filter((t) => (NINJA_TYPES as readonly string[]).includes(t))) {
    const lines = await ninjaLines(league, type);
    const hits = lines.filter((l) => {
      const ln = String(l.name ?? "").toLowerCase();
      if (kind === "gem") return (ln === want || ln === `${want} support`) && !l.corrupted;
      return ln === want && !(l.links >= 5);
    }).filter((l) => l.chaosValue > 0);
    if (hits.length) {
      const best = hits.reduce((a, b) => (a.chaosValue <= b.chaosValue ? a : b));
      return { chaos: best.chaosValue, name: best.name };
    }
  }
  return undefined;
}

/** A trade search link (instant buyout only) that opens in the browser; no request is made here. */
export function tradeLink(league: string, query: Record<string, unknown>): string {
  const q = { query: { status: { option: "securable" }, ...query }, sort: { price: "asc" } };
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(q))}`;
}

/** "2 div", "150c", "3 div + 150c", "300" -> chaos (Stage 5 parser). */
export function parseBudget(text: string, divine: number): number | undefined {
  try {
    return parseBudgetText(text, new Map(divine > 0 ? [["Divine Orb", divine]] : [])).chaos;
  } catch {
    return undefined;
  }
}
