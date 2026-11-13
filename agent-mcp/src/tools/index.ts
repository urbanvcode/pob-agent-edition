/**
 * The public tool list, in the order clients show it.
 *
 * Every tool definition is loaded into the AI's context in every conversation, so
 * overlapping tools are merged into one name with a mode (Stage 16 budget note in
 * ROADMAP.md). The original tools stay as internal handlers: the merged tools route
 * to them, and their old names still work as hidden aliases (ALIASES).
 */
import { ToolError } from "../pob.js";
import { S, routed, tool, type Args, type Tool } from "../registry.js";
import type { TradeApiClient } from "../trade/client.js";
import { adviceTools, atlasTools } from "./advice.js";
import { characterTools } from "./character.js";
import { editTools } from "./edit.js";
import { guideTools } from "./guides.js";
import { knowledgeTools } from "./knowledge.js";
import { optimiseTools } from "./optimise.js";
import { readTools } from "./read.js";
import { profileTools, sessionTools } from "./session.js";
import { checkLeague, tradeTools } from "./trade.js";

/** Internal tools that change, open or save a build (refused when the server runs read-only). */
const WRITES: Record<string, (a: Args) => boolean> = {
  edit: () => true, edit_items: () => true, edit_skills: () => true, edit_tree: () => true,
  set_config: (a) => !!a.values && typeof a.values === "object" && Object.keys(a.values).length > 0,
  what_if: (a) => a.keep === true,
  restore: () => true, open_build: () => true, save_build: (a) => a.export_code !== true,
  atlas_edit: () => true, guide_import: () => true, character_sync: () => true,
};

/** Old tool names (0.8.0 and earlier) that still work: they call the original handler with the same arguments. */
export const ALIASES = [
  "profile_get", "profile_set", "profile_mark_learned", "open_options",
  "character_sync", "character_history",
  "edit_items", "edit_skills", "edit_tree", "restore",
  "suggest_passives", "anoint", "suggest_gems", "suggest_jewels",
  "guide_import", "guide_compare", "guide_next_steps",
  "leagues", "currency", "price_check",
  "atlas_get", "atlas_search", "atlas_edit",
];

const has = (a: Args, ...keys: string[]) => keys.some((k) => a[k] !== undefined && a[k] !== null && !(Array.isArray(a[k]) && !a[k].length));
const without = (a: Args, ...keys: string[]) => Object.fromEntries(Object.entries(a).filter(([k]) => !keys.includes(k)));
const FOCUS = S.enum(["balanced", "dps", "defence"]);
const JEWELS = ["jewel", "abyss", "watchers_eye", "cluster"];
const PROFILE_SET = ["playMode", "hardcore", "league", "currency", "goals", "add_goals", "remove_goals", "experience", "explanationMode", "reset_learned"];

/** Every handler, public or not, by name. */
export function internalTools(trade: TradeApiClient): Tool[] {
  const trades = tradeTools();
  const list = [
    ...profileTools((league) => checkLeague(trade, league)),
    ...sessionTools,
    ...characterTools(),
    ...readTools,
    ...editTools,
    ...adviceTools,
    ...optimiseTools(trades.find((t) => t.name === "plan_upgrades")),
    ...guideTools,
    ...trades,
    ...atlasTools,
    ...knowledgeTools(),
  ];
  for (const t of list) if (WRITES[t.name]) t.writes = WRITES[t.name];
  return list;
}

export function allTools(trade: TradeApiClient, internal: Tool[] = internalTools(trade)): Tool[] {
  const get = (name: string): Tool => {
    const t = internal.find((x) => x.name === name);
    if (!t) throw new Error(`internal tool ${name} missing`);
    return t;
  };
  const keep = (name: string) => get(name);
  const profileSet = get("profile_set").inputSchema.properties;
  const learnedAndSet = tool("profile_learned", "internal", {}, [], async (ctx, args) => {
    const out = [await get("profile_mark_learned").run(ctx, { topics: args.learned })];
    if (has(args, ...PROFILE_SET)) out.push(await get("profile_set").run(ctx, without(args, "learned")));
    return out.join("\n\n");
  });
  const badKind = tool("suggest_kind", "internal", {}, [], async () => { throw new ToolError(`kind must be one of: passives, anoint, gems, ${JEWELS.join(", ")}.`); });

  const profile = routed("profile",
    "Player profile (trade/SSF, hardcore, league, currency, goals, explanation mode) and how to answer. No args: read it (first, once per conversation). Fields: change it, only when the player asks or states a fact. learned: topics just explained (teach).",
    { ...profileSet, learned: S.list(S.str()) }, [],
    (a) => {
      if (has(a, "learned")) return [{ ...get("profile_mark_learned"), run: async (ctx, args) => {
        const out = [await get("profile_mark_learned").run(ctx, { topics: args.learned })];
        if (has(args, ...PROFILE_SET)) out.push(await get("profile_set").run(ctx, without(args, "learned")));
        return out.join("\n\n");
      } }, a];
      return has(a, ...PROFILE_SET) ? [get("profile_set"), a] : [get("profile_get"), {}];
    });

  const setView = get("set_view");
  const view = routed("set_view", "Switch the PoB window to a tab the player should look at. OPTIONS opens the Options window (Agent profile, POESESSID).",
    { view: S.enum([...((setView.inputSchema.properties.view as any).enum as string[]), "OPTIONS"]) }, ["view"],
    (a) => (a.view === "OPTIONS" ? [get("open_options"), {}] : [setView, a]));

  const character = routed("character",
    'Sync the public pathofexile.com character into its own build "<character> - synced" and list changes since the last sync (items, gems, passives, DPS/EHP/max hit). Names remembered; no login. history: true = timeline.',
    { account: S.str("Name#1234"), character: S.str(), realm: S.enum(["pc", "xbox", "sony"]), history: S.bool(), limit: S.num(), discard_unsaved: S.bool() }, [],
    (a) => (a.history === true ? [get("character_history"), { character: a.character, limit: a.limit }] : [get("character_sync"), without(a, "history", "limit")]));

  const snapshot = routed("snapshot", 'Remember the open build (compare with "snapshot:<name>"). restore: true puts that snapshot back (shows as unsaved).',
    { name: S.str(), restore: S.bool() }, [],
    (a) => (a.restore === true ? [get("restore"), { name: a.name }] : [get("snapshot"), { name: a.name }]));

  const suggest = routed("suggest",
    "Simulated options for one lever, ranked. kind: passives (gain per point, with path), anoint (with oils), gems (each support's worth, then fitting supports in place of the weakest; add: extra link), jewel/abyss/watchers_eye/cluster (best mods).",
    {
      kind: S.enum(["passives", "anoint", "gems", ...JEWELS]), focus: FOCUS, limit: S.num(),
      points: S.num("default 5"), group: S.num(), replace: S.num(), add: S.bool(), awakened: S.bool(), slot: S.str(), socket: S.str(),
    }, ["kind"],
    (a) => {
      const k = String(a.kind ?? "");
      if (k === "passives") return [get("suggest_passives"), { max_points: a.points, focus: a.focus, limit: a.limit }];
      if (k === "anoint") return [get("anoint"), { focus: a.focus, limit: a.limit, slot: a.slot }];
      if (k === "gems") return [get("suggest_gems"), { group: a.group, replace: a.replace, add: a.add, awakened: a.awakened, limit: a.limit }];
      if (JEWELS.includes(k)) return [get("suggest_jewels"), { kind: k, focus: a.focus, limit: a.limit, socket: a.socket }];
      return [badKind, a];
    });

  const guide = routed("guide",
    'Build guides, simulated. source: import a PoB code or pobb.in/poe.ninja/pastebin/maxroll link (or "Stage: link" lines) as "Guide - <name>"; loadouts = stages. Else compare the open build with the guide stage (passive path, gems, items, gap); next: true = actions by gain per cost within budget. Updates the Guide card.',
    {
      source: S.str(), name: S.str(), next: S.bool(), guide: S.str(), stage: S.str('"auto" detects'),
      accept: S.list(S.str(), "never flagged again"), unaccept: S.list(S.str()), notes: S.bool(), budget: S.str('"2 div"'), limit: S.num(),
    }, [],
    (a) => {
      if (has(a, "source")) return [get("guide_import"), { source: a.source, name: a.name }];
      if (a.next === true) return [get("guide_next_steps"), without(a, "next", "source", "name")];
      return [get("guide_compare"), without(a, "next", "source", "name", "budget", "limit")];
    });

  const prices = routed("prices",
    "Prices, profile league by default. name: cheapest instant-buyout listings (unique, gem, base). No name: poe.ninja currency rates in chaos and the worth of the currency on hand. leagues: true lists trade leagues. own: true = what the build's items and gems are worth (what to sell).",
    { name: S.str(), type: S.str("base type"), search: S.str("currency filter"), leagues: S.bool(), own: S.bool(), league: S.str() }, [],
    (a) => {
      if (a.leagues === true) return [get("leagues"), {}];
      if (a.own === true) return [get("price_own"), { league: a.league }];
      if (has(a, "name")) return [get("price_check"), { name: a.name, type: a.type, league: a.league }];
      return [get("currency"), { league: a.league, search: a.search }];
    }, { trade: true });

  const atlas = routed("atlas",
    "Atlas tree (150 points). No args: points, notables, points per mechanic, bonuses, share link. query: find passives (ids, cost). Change it: add/remove ids (with paths), replace the list, or link (atlas URL).",
    { query: S.str(), limit: S.num(), add: S.list(S.str()), remove: S.list(S.str()), replace: S.list(S.str()), link: S.str() }, [],
    (a) => {
      if (has(a, "add", "remove", "replace", "link")) return [get("atlas_edit"), { add: a.add, remove: a.remove, replace: a.replace, link: a.link }];
      if (has(a, "query")) return [get("atlas_search"), { query: a.query, limit: a.limit }];
      return [get("atlas_get"), {}];
    });

  return [
    profile, keep("status"), keep("list_builds"), keep("open_build"), keep("save_build"), view,
    character,
    keep("build_summary"), keep("stats"), keep("diagnose"), keep("tree_search"),
    keep("edit"), keep("set_config"), keep("what_if"), snapshot, keep("compare"),
    suggest, keep("affixes"), keep("optimise"),
    guide,
    keep("trade_search"), keep("plan_upgrades"), prices,
    atlas,
    keep("kb_lookup"), keep("kb_patch"),
  ];
}
