/** Edit and simulate: edit_items, edit_skills, edit_tree, set_config, what_if, snapshot, restore, compare. */
import fs from "fs";
import path from "path";
import { deltaLines, n, type Stats } from "../format.js";
import { cacheDir } from "../paths.js";
import { ToolError, type Pob } from "../pob.js";
import { S, tool, type Args, type Context, type Tool } from "../registry.js";
import { buildFile, currentBuildsDir } from "./session.js";

type Op = Record<string, unknown> & { op: string };

const ITEM_OPS = ["equip", "unequip", "flask", "item_set"];
const SKILL_OPS = ["main_skill", "add_group", "remove_group", "group_enabled", "add_gem", "remove_gem", "gem"];
const TREE_OPS = ["alloc", "dealloc", "mastery", "spec"];

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
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v}`);
  return `ok ${result.op}${bits.length ? `: ${bits.join("; ")}` : ""}`;
}

function changeReport(res: any, live: boolean, kept: boolean): string {
  const lines: string[] = (res.results as any[]).map(describe);
  const delta = deltaLines(res.before as Stats, res.after as Stats);
  lines.push("", delta.length ? "Before -> after:" : "No calculated stat changed.", ...delta);
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

const OPS = S.list(S.obj(), "Ops, applied in order");

export const editTools: Tool[] = [
  tool("edit_items", 'Change gear in the open build. Ops: {op:"equip",slot,text} (PoB/in-game item text) or {op:"equip",slot,id} (item already in the build), {op:"unequip",slot}, {op:"flask",index:1-5,active}, {op:"item_set",id}. Returns before/after stats.',
    { ops: OPS }, ["ops"], async (ctx, args) => applyEdit(ctx, opList(args, ITEM_OPS, "edit_items"))),

  tool("edit_skills", 'Change skill gems. Group and gem numbers come from build_summary. Ops: {op:"main_skill",group,skill?,part?}, {op:"add_group",label?,slot?,gems:[{name,level?,quality?}]}, {op:"remove_group",group}, {op:"group_enabled",group,enabled}, {op:"add_gem",group,name,level?,quality?}, {op:"remove_gem",group,gem}, {op:"gem",group,gem,level?,quality?,enabled?}.',
    { ops: OPS }, ["ops"], async (ctx, args) => applyEdit(ctx, opList(args, SKILL_OPS, "edit_skills"))),

  tool("edit_tree", 'Change the passive tree. Node ids come from tree_search. Ops: {op:"alloc",nodes:[ids]} (takes the shortest path too), {op:"dealloc",nodes:[ids]} (also drops nodes that depended on them), {op:"mastery",node,effect}, {op:"spec",index} or {op:"spec",create:"title",copy_from?} to switch or add a tree spec.',
    { ops: OPS }, ["ops"], async (ctx, args) => applyEdit(ctx, opList(args, TREE_OPS, "edit_tree"))),

  tool("set_config", 'Read or change PoB\'s Configuration (enemy, charges, conditions, bandit, character level). search finds option keys; values sets them, e.g. {"enemyIsBoss":"Pinnacle","usePowerCharges":true,"level":92}.',
    { search: S.str("Find option keys by text"), values: S.obj() }, [],
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

  tool("what_if", "Simulate changes without keeping them: applies any ops from edit_items / edit_skills / edit_tree plus {op:\"config\",values}, returns before/after stats, then rolls back. keep: true leaves the changes in (only if every op worked).",
    { ops: OPS, keep: S.bool() }, ["ops"],
    async ({ pob }, args) => {
      const ops = opList(args, null, "what_if");
      const link = await pob.link();
      const res = await link.call("what_if", { ops, keep: args.keep === true });
      let text = changeReport(res, link.kind === "live", res.kept === true);
      if (!res.kept) {
        text += res.rolledBack
          ? `\nRolled back: the build is as it was.${args.keep === true ? " (keep was ignored because an op failed.)" : ""}`
          : `\nWARNING: the roll back did not restore the build exactly (${res.rollbackProblem}). Tell the player; Ctrl+Z in PoB or restore a snapshot fixes it.`;
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
      return `Snapshot "${name}" taken of ${stats.name} (Combined DPS ${n(stats.stats.CombinedDPS)}, EHP ${n(stats.stats.TotalEHP)}). restore brings it back; compare with "snapshot:${name}".`;
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

  tool("compare", 'Compare two builds: stats, tree, items, gems. Each side is "current", "snapshot:<name>" or a saved build name. The other build is calculated separately; the window is not touched.',
    { a: S.str('Default "current"'), b: S.str() }, ["b"],
    async ({ pob }, args) => {
      const a = await loadSide(pob, typeof args.a === "string" ? args.a : "current");
      const b = await loadSide(pob, String(args.b));
      return compareText(a, b);
    }),
];
