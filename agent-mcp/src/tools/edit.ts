/** Edit and simulate: edit (edit_items, edit_skills, edit_tree as aliases), set_config, what_if, snapshot, restore, compare. */
import fs from "fs";
import path from "path";
import { deltaLines, n, type Stats } from "../format.js";
import { cacheDir } from "../paths.js";
import { ToolError, type Pob } from "../pob.js";
import { S, tool, type Args, type Context, type Tool } from "../registry.js";
import { buildFile, currentBuildsDir } from "./session.js";
import { TREE_HINT } from "./optimise.js";
import { planText, treeTarget } from "./treeplan.js";

type Op = Record<string, unknown> & { op: string };

const ITEM_OPS = ["equip", "unequip", "flask", "item_set"];
const SKILL_OPS = ["main_skill", "add_group", "remove_group", "group_enabled", "add_gem", "remove_gem", "gem"];
const TREE_OPS = ["alloc", "dealloc", "mastery", "spec", "spec_notes"];

function opList(args: Args, allowed: string[] | null, toolName: string): Op[] {
  const ops = args.ops;
  if (!Array.isArray(ops) || !ops.length) throw new ToolError(`${toolName} needs ops: a non-empty list like [{"op":"${allowed?.[0] ?? "equip"}", ...}].`);
  for (const o of ops) {
    if (!o || typeof o !== "object" || typeof o.op !== "string") throw new ToolError('Each op is an object with an "op" field.');
    if (allowed && !allowed.includes(o.op)) throw new ToolError(`${toolName} does not do "${o.op}". Its ops: ${allowed.join(", ")}.`);
  }
  return ops as Op[];
}

function describe(result: any): string {
  if (!result.ok) return `FAILED ${result.op ?? "?"}: ${result.error}`;
  const r = result.result ?? {};
  const bits = Object.entries(r)
    .filter(([k]) => k !== "unparsed")
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v}`);
  return `ok ${result.op}${bits.length ? `: ${bits.join("; ")}` : ""}`;
}

const dpsOf = (s: any) => (s?.FullDPS > 0 ? s.FullDPS : s?.CombinedDPS ?? s?.TotalDPS ?? 0) as number;
const pctOf = (a: number, b: number) => (b > 0 ? `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%` : "?");

/** A change that leaves a skill without enough mana/life/ES to use (PoB's own warning). PoB still
 *  counts that skill in DPS, so the plain before/after is a paper gain: show the real result and
 *  the cheapest reserving skill to switch off instead. */
export function costText(cost: any, before: Stats): string[] {
  const warnings = (Array.isArray(cost?.warnings) ? cost.warnings : []) as any[];
  if (!warnings.length) return [];
  const base = dpsOf(before);
  const vs = (s: any) => `DPS ${pctOf(dpsOf(s), base)}, EHP ${pctOf(s?.TotalEHP ?? 0, before.TotalEHP ?? 0)} vs before`;
  const L = cost.overReserved
    ? [`Warning: mana is over-reserved after this change (${n(cost.manaUnreserved)} unreserved), so these skills can't be used: ${warnings.map((w) => `${w.skill} (${Math.ceil(w.cost)})`).join(", ")}.`]
    : warnings.map((w) => `Warning: ${w.text}.`);
  L.push("PoB still counts them in the numbers above, so those are not what happens in game.");
  if (cost.blockedOff) L.push(`Real result (${warnings.map((w) => w.skill).join(", ")} switched off): ${vs(cost.blockedOff.stats)} | ops: ${JSON.stringify(cost.blockedOff.ops)}`);
  const opts = ((Array.isArray(cost.options) ? cost.options : []) as any[]).slice()
    .sort((a, b) => dpsOf(b.stats) - dpsOf(a.stats) || (b.stats?.TotalEHP ?? 0) - (a.stats?.TotalEHP ?? 0));
  const fit = opts.find((o) => o.fits);
  if (fit) L.push(`Cheapest fix: switch off ${fit.skill}${fit.freed ? ` (frees ${fit.freed} mana)` : ""} and everything fits: ${vs(fit.stats)} | ops: ${JSON.stringify(fit.ops)}`);
  else if (opts.length) L.push("No single reserving skill switched off makes everything fit.");
  const rest = opts.filter((o) => o !== fit).slice(0, 4).map((o) => `${o.skill} off: ${vs(o.stats)}${o.fits ? "" : " (still short)"}`);
  if (rest.length) L.push(`Other options: ${rest.join("; ")}`);
  return L;
}

const CONFIG_LABEL: Record<string, string> = { Shock: "Is the enemy Shocked?", Chill: "Is the enemy Chilled?", Ignite: "Is the enemy Ignited?", Freeze: "Is the enemy Frozen?" };

/** A change after which the main skill can no longer inflict an ailment it did before (Elemental
 *  Focus: "cannot inflict elemental ailments"). PoB measures the shock/chill only when the config
 *  sets it, so a config that still sets it keeps counting a shock the build no longer applies. */
export function ailmentText(a: any): string[] {
  const lost = (Array.isArray(a?.lost) ? a.lost : []) as any[];
  if (!lost.length) return [];
  const L = [`Warning: ${a.skill ?? "the main skill"} can no longer inflict ${lost.map((x) => String(x.name).toLowerCase()).join(", ")}: ${a.text ?? "it loses those ailments"}.`];
  const still = (Array.isArray(a.configStillOn) ? a.configStillOn : []) as string[];
  if (still.length) L.push(`The config still says the enemy has it (${still.map((s) => `"${CONFIG_LABEL[s] ?? s}"`).join(", ")}), so PoB keeps counting it: the DPS after is too high. Switch ${still.length > 1 ? "them" : "it"} off with set_config to see the real number, unless something else applies it.`);
  return L;
}

/** Item lines PoB could not parse (red in its tooltip): they count for nothing in the numbers.
 *  Custom theorycraft items (a new league's uniques) are checked this way. */
export function unparsedText(results: any[]): string[] {
  const L: string[] = [];
  for (const r of Array.isArray(results) ? results : []) {
    const lines = (r?.ok && Array.isArray(r.result?.unparsed) ? r.result.unparsed : []) as string[];
    if (!lines.length) continue;
    L.push(`Warning: PoB did not understand ${lines.length === 1 ? "this line" : `${lines.length} lines`} of ${r.result.name ?? "the item"} (${r.result.slot ?? "?"}), so ${lines.length === 1 ? "it adds" : "they add"} nothing to the numbers:`,
      ...lines.map((l) => `  - ${l}`));
  }
  if (L.length) L.push("Reword the line the way PoB writes similar mods (a unique's line in PoB's item list), or treat the result as missing that effect.");
  return L;
}

function changeReport(res: any, live: boolean, kept: boolean): string {
  const lines: string[] = (res.results as any[]).map(describe);
  const unparsed = unparsedText(res.results);
  if (unparsed.length) lines.push("", ...unparsed);
  const delta = deltaLines(res.before as Stats, res.after as Stats);
  lines.push("", delta.length ? "Before -> after:" : "No calculated stat changed.", ...delta);
  const ailments = ailmentText(res.ailments);
  if (ailments.length) lines.push("", ...ailments);
  const cost = costText(res.cost, res.before as Stats);
  if (cost.length) lines.push("", ...cost);
  lines.push("", `Config assumptions: ${res.assumptions}`);
  const changed = (res.results as any[]).some((r) => r.ok);
  if (kept && !changed) lines.push("Nothing was changed.");
  else if (kept) lines.push(live ? "The change is in the PoB window, not saved. To keep it: save_build with a new name." : "Changed in the headless engine only. To keep it: save_build with a new name.");
  return lines.join("\n");
}

async function applyEdit({ pob }: Context, ops: Op[]): Promise<string> {
  const link = await pob.link();
  const res = await link.call("edit", { ops });
  return changeReport(res, link.kind === "live", true);
}

// --- snapshots -------------------------------------------------------------------
const snapshots = new Map<string, { file: string; build: string; at: number }>();
let snapshotCounter = 0;

function snapshotFile(name: string): string {
  return path.join(cacheDir("snapshots"), name.replace(/[^\w .-]+/g, "_") + ".xml");
}

function knownSnapshots(): string[] {
  const dir = cacheDir("snapshots");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".xml")).map((f) => f.replace(/\.xml$/, ""));
}

function readSnapshot(name: string): string {
  const file = snapshots.get(name)?.file ?? snapshotFile(name);
  if (!fs.existsSync(file)) {
    const known = knownSnapshots();
    throw new ToolError(`No snapshot named "${name}".${known.length ? ` Snapshots: ${known.slice(-15).join(", ")}.` : " Take one with snapshot first."}`);
  }
  return fs.readFileSync(file, "utf8");
}

// --- compare ---------------------------------------------------------------------
interface Side { title: string; stats: Stats; summary: any; assumptions: string }

async function loadSide(pob: Pob, ref: string): Promise<Side> {
  if (!ref || ref === "current") {
    const link = await pob.link();
    const [stats, summary] = [await link.call("key_stats"), await link.call("summary")];
    return { title: `current (${stats.name})`, stats: stats.stats, summary: summary.summary, assumptions: stats.assumptions };
  }
  let xml: string, title: string;
  if (ref.startsWith("snapshot:")) {
    title = ref;
    xml = readSnapshot(ref.slice(9));
  } else {
    const file = buildFile(await currentBuildsDir(pob), ref);
    if (!fs.existsSync(file)) throw new ToolError(`No build named "${ref}". Use list_builds for names, or "snapshot:<name>" / "current".`);
    title = ref;
    xml = fs.readFileSync(file, "utf8");
  }
  const side = await pob.sideLink();
  await side.call("load_build_xml", { xml, name: title });
  const [stats, summary] = [await side.call("key_stats"), await side.call("summary")];
  return { title, stats: stats.stats, summary: summary.summary, assumptions: stats.assumptions };
}

function listDiff(label: string, a: string[], b: string[]): string[] {
  const inA = a.filter((x) => !b.includes(x)), inB = b.filter((x) => !a.includes(x));
  const out: string[] = [];
  if (inA.length) out.push(`${label} only in A: ${inA.join(", ")}`);
  if (inB.length) out.push(`${label} only in B: ${inB.join(", ")}`);
  return out;
}

function compareText(a: Side, b: Side): string {
  const L = [`A = ${a.title}`, `B = ${b.title}`, "", "STATS A -> B"];
  const delta = deltaLines(a.stats, b.stats);
  L.push(...(delta.length ? delta : ["identical"]));
  const ta = a.summary.tree ?? {}, tb = b.summary.tree ?? {};
  L.push("", `TREE: A ${ta.pointsUsed} points, B ${tb.pointsUsed} points`);
  L.push(...listDiff("Keystones", ta.keystones ?? [], tb.keystones ?? []), ...listDiff("Notables", ta.notables ?? [], tb.notables ?? []));
  const items = (s: any) => new Map<string, string>((s.items ?? []).map((it: any) => [it.slot, it.name ? `${it.name}${it.base && !it.name.includes(it.base) ? `, ${it.base}` : ""}` : "(empty)"]));
  const ia = items(a.summary), ib = items(b.summary);
  const itemLines = [...new Set([...ia.keys(), ...ib.keys()])].filter((slot) => (ia.get(slot) ?? "(empty)") !== (ib.get(slot) ?? "(empty)") && !/^Jewel \d+$/.test(slot))
    .map((slot) => `${slot}: ${ia.get(slot) ?? "(empty)"}  ->  ${ib.get(slot) ?? "(empty)"}`);
  L.push("", "ITEMS that differ", ...(itemLines.length ? itemLines : ["none"]));
  const gems = (s: any) => (s.groups ?? []).filter((g: any) => g.enabled).flatMap((g: any) => (g.gems ?? []).filter((x: any) => x.enabled).map((x: any) => x.name)) as string[];
  const gemLines = listDiff("Gems", [...new Set(gems(a.summary))], [...new Set(gems(b.summary))]);
  L.push("", "GEMS", ...(gemLines.length ? gemLines : ["same gems"]));
  L.push("", `Config assumptions A: ${a.assumptions}`, `Config assumptions B: ${b.assumptions}`);
  return L.join("\n");
}

const OPS = S.list(S.obj());

export const editTools: Tool[] = [
  tool("edit", 'Change the open build, before/after. Ops in order. Items: {op:"equip",slot,text|id}, {op:"unequip",slot}, {op:"flask",index,active}, {op:"item_set",id}. Skills (numbers: build_summary): {op:"main_skill",group}, {op:"add_group",gems:[{name,level?,quality?}]}, {op:"remove_group",group}, {op:"group_enabled",group,enabled}, {op:"add_gem",group,name}, {op:"remove_gem",group,gem}, {op:"gem",group,gem,level?,quality?,enabled?}. Tree (ids: tree_search): {op:"alloc"|"dealloc",nodes}, {op:"mastery",node,effect}, {op:"spec",index|create},{op:"spec_notes",spec,notes:{id:"why"}}. {op:"config",values}.',
    { ops: OPS }, ["ops"], async (ctx, args) => applyEdit(ctx, opList(args, [...ITEM_OPS, ...SKILL_OPS, ...TREE_OPS, "config"], "edit"))),

  tool("edit_items", 'Change gear in the open build. Ops: {op:"equip",slot,text} (PoB/in-game item text) or {op:"equip",slot,id} (item already in the build), {op:"unequip",slot}, {op:"flask",index:1-5,active}, {op:"item_set",id}. Returns before/after stats.',
    { ops: OPS }, ["ops"], async (ctx, args) => applyEdit(ctx, opList(args, ITEM_OPS, "edit_items"))),

  tool("edit_skills", 'Change skill gems. Group and gem numbers come from build_summary. Ops: {op:"main_skill",group,skill?,part?}, {op:"add_group",label?,slot?,gems:[{name,level?,quality?}]}, {op:"remove_group",group}, {op:"group_enabled",group,enabled}, {op:"add_gem",group,name,level?,quality?}, {op:"remove_gem",group,gem}, {op:"gem",group,gem,level?,quality?,enabled?}.',
    { ops: OPS }, ["ops"], async (ctx, args) => applyEdit(ctx, opList(args, SKILL_OPS, "edit_skills"))),

  tool("edit_tree", 'Change the passive tree. Node ids come from tree_search. Ops: {op:"alloc",nodes:[ids]} (takes the shortest path too), {op:"dealloc",nodes:[ids]} (also drops nodes that depended on them), {op:"mastery",node,effect}, {op:"spec",index} or {op:"spec",create:"title",copy_from?} to switch or add a tree spec.',
    { ops: OPS }, ["ops"], async (ctx, args) => applyEdit(ctx, opList(args, TREE_OPS, "edit_tree"))),

  tool("set_config", 'PoB Configuration (enemy, charges, conditions, bandit, level). search: find option keys; values: set them, e.g. {"enemyIsBoss":"Pinnacle","level":92}.',
    { search: S.str(), values: S.obj() }, [],
    async (ctx, args) => {
      const link = await ctx.pob.link();
      if (!args.values || !Object.keys(args.values).length) {
        const res = await link.call("config_search", { query: args.search ?? "" });
        const options = (Array.isArray(res.options) ? res.options : []) as any[];
        if (!options.length) return `No config option matches "${args.search}".`;
        return options.map((o) => `${o.key} (${o.type}${o.options ? `: ${o.options.join(" | ")}` : ""}) = ${o.value ?? "unset"}  // ${o.label}`).join("\n");
      }
      const res = await link.call("edit", { ops: [{ op: "config", values: args.values }] });
      const r = res.results[0];
      if (!r.ok) throw new ToolError(r.error);
      const applied = Object.entries(r.result.applied ?? {}).map(([k, v]) => `${k}=${v}`);
      const rejected = Object.entries(r.result.rejected ?? {}).map(([k, v]) => `${k}: ${v}`);
      const lines = [applied.length ? `Set: ${applied.join(", ")}` : "Nothing was set."];
      if (rejected.length) lines.push(`Rejected: ${rejected.join("; ")}. Use set_config with search to find the right key and values.`);
      const delta = deltaLines(res.before, res.after);
      lines.push("", delta.length ? "Before -> after:" : "No calculated stat changed.", ...delta, "", `Config assumptions: ${res.assumptions}`);
      return lines.join("\n");
    }),

  tool("what_if", "Simulate edit ops: before/after stats, then roll back. keep: true leaves them in (only if every op worked).",
    { ops: OPS, keep: S.bool() }, ["ops"],
    async ({ pob }, args) => {
      const ops = opList(args, null, "what_if");
      const link = await pob.link();
      const res = await link.call("what_if", { ops, keep: args.keep === true });
      let text = changeReport(res, link.kind === "live", res.kept === true);
      if (res.kept && ops.some((o) => ["alloc", "dealloc", "mastery"].includes(o.op))) text += `
${TREE_HINT}`;
      if (!res.kept) {
        text += res.rolledBack
          ? `\nRolled back: the build is as it was.${args.keep === true ? " (keep was ignored because an op failed.)" : ""}`
          : `\nWARNING: the roll back did not restore the build exactly (${res.rollbackProblem}). Tell the player; Ctrl+Z in PoB or snapshot { name, restore: true } fixes it.`;
      }
      return text;
    }),

  tool("snapshot", "Remember the open build as it is now, to restore or compare later.", { name: S.str() }, [],
    async ({ pob }, args) => {
      const link = await pob.link();
      const [{ xml }, stats] = [await link.call("export_build_xml"), await link.call("key_stats")];
      const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : `snap-${++snapshotCounter}`;
      const file = snapshotFile(name);
      fs.writeFileSync(file, String(xml), "utf8");
      snapshots.set(name, { file, build: stats.name, at: Date.now() });
      return `Snapshot "${name}" taken of ${stats.name} (Combined DPS ${n(stats.stats.CombinedDPS)}, EHP ${n(stats.stats.TotalEHP)}). snapshot with restore: true brings it back; compare with "snapshot:${name}".`;
    }),

  tool("restore", "Put a snapshot back as the open build (the window keeps its file name and shows unsaved changes).", { name: S.str() }, ["name"],
    async ({ pob }, args) => {
      const xml = readSnapshot(String(args.name));
      const link = await pob.link();
      if (link.kind === "live") await link.call("restore_build_xml", { xml });
      else await link.call("load_build_xml", { xml, name: pob.headlessBuild?.name ?? String(args.name) });
      const stats = await link.call("key_stats");
      return `Restored snapshot "${args.name}" (Combined DPS ${n(stats.stats.CombinedDPS)}, EHP ${n(stats.stats.TotalEHP)}).`;
    }),

  tool("compare", 'Compare two builds (stats, tree, items, gems) without touching the window. Each side: "current" (default a), "snapshot:<name>" or a saved build name. tree: respec plan vs a tree no./title, build or "last sync".',
    { a: S.str(), b: S.str(), tree: {}, skip: S.list(S.str(), "change ids to untick"), save_as: S.str("new tree") }, [],
    async ({ pob }, args) => {
      if (args.tree !== undefined && args.tree !== null) {
        const link = await pob.link();
        const res = await link.call("tree_plan", { ...(await treeTarget(pob, link, args.tree)), skip: args.skip, save_as: args.save_as });
        return planText(res);
      }
      if (typeof args.b !== "string" || !args.b) throw new ToolError('compare needs b (a build, "snapshot:<name>") or tree.');
      const a = await loadSide(pob, typeof args.a === "string" ? args.a : "current");
      const b = await loadSide(pob, String(args.b));
      return compareText(a, b);
    }),
];
