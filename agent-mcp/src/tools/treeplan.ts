/**
 * Tree compare as a respec planner: compare { tree } and set_view { view: "TREE", compare }.
 * PoB's side is PathOfBuilding/src/Agent/Handlers/TreePlan.lua (numbers) and the Tree tab
 * (labels and the changes panel); this file only resolves what to compare with and writes text.
 */
import fs from "fs";
import path from "path";
import { listHistories } from "../character.js";
import { n, pct } from "../format.js";
import { ToolError, type Pob } from "../pob.js";
import { download, rawUrl } from "../guideMode.js";
import { readSnapshot } from "./edit.js";
import { buildFile, currentBuildsDir, decodeBuildCode } from "./session.js";

type Link = Awaited<ReturnType<Pob["link"]>>;

/** The previous character sync of the open build's character: its saved XML and a title. */
export function lastSyncXml(buildName: string | undefined, characterHash: string | undefined): { xml: string; title: string } {
  const all = listHistories();
  const found = all.find((h) => characterHash && h.history.characterHash === characterHash) ?? all.find((h) => buildName && h.history.build === buildName);
  const pickAny = !buildName && !characterHash ? all[0] : undefined;
  const hit = pickAny ?? found;
  if (!hit) throw new ToolError("No character sync matches this build. Sync the character first (character { account, character }).");
  const dir = hit.file.replace(/\.json$/, "");
  const snaps = hit.history.entries.filter((e) => e.snapshot && fs.existsSync(path.join(dir, e.snapshot))).reverse();
  if (!snaps.length) throw new ToolError(`No saved sync snapshot for ${hit.history.character}; sync again to make one.`);
  // The synced build itself is the newest sync: compare with the one before it.
  const pick = hit.history.build === buildName && snaps[1] ? snaps[1] : snaps[0];
  return { xml: fs.readFileSync(path.join(dir, pick.snapshot!), "utf8"), title: `Last sync ${pick.at.replace("T", " ").slice(0, 16)}` };
}

/** What tree_plan / the Tree tab compare with: { compare } = a tree of the open build; { xml, title, spec? } = any other tree. */
export type Target = { compare?: number | string; xml?: string; title?: string; spec?: string };

const isCode = (t: string) => t.length >= 80 && /^[A-Za-z0-9_\-+/=]+$/.test(t);

/**
 * Any tree: a tree number or title of the open build, a saved build ("<character> - synced" too),
 * "guide:<name>[:stage]", "last sync", "snapshot:<name>", a PoB code or a pobb.in / poe.ninja /
 * pastebin / maxroll link (the guide importer's download, nothing is saved).
 * openSpecs = false: a title is never taken as a tree of the open build (pair compare).
 */
export async function treeTarget(pob: Pob, link: Link | null, ref: unknown, openSpecs = true): Promise<Target> {
  if (typeof ref === "number" || (typeof ref === "string" && /^\d+$/.test(ref.trim()))) return { compare: Number(ref) };
  const want = String(ref ?? "").trim();
  if (!want) throw new ToolError('Name a tree: a tree number or title, a build, "guide:<name>[:stage]", "last sync", a PoB code or a build link.');
  if (/^(the )?(last|previous) sync$/i.test(want)) {
    const ks = link ? await link.call("key_stats").catch(() => null) : null;
    return lastSyncXml(ks?.name, ks?.characterHash);
  }
  if (/^https?:\/\//i.test(want)) {
    const url = rawUrl(want);
    return { xml: decodeBuildCode(await download(url!)), title: `Link ${new URL(want).hostname}` };
  }
  if (isCode(want)) return { xml: decodeBuildCode(want), title: "Pasted code" };
  if (/^snapshot:/i.test(want)) return { xml: readSnapshot(want.slice(9)), title: want };
  const dir = await currentBuildsDir(pob);
  const g = /^guide:\s*([^:]+?)\s*(?::\s*(.+))?$/i.exec(want);
  if (g) {
    const name = /^guide - /i.test(g[1]) ? g[1] : `Guide - ${g[1]}`;
    const file = [buildFile(dir, name), buildFile(dir, g[1])].find((f) => fs.existsSync(f));
    if (!file) throw new ToolError(`No guide "${g[1]}" in the Builds folder (import one with guide { source }).`);
    return { xml: fs.readFileSync(file, "utf8"), title: path.basename(file, ".xml"), spec: g[2] };
  }
  if (openSpecs && link) {
    const specs = ((await link.call("list_specs").catch(() => null))?.result?.specs ?? []) as any[];
    if (specs.some((s) => String(s.title ?? "").toLowerCase() === want.toLowerCase())) return { compare: want };
  }
  const file = buildFile(dir, want);
  if (fs.existsSync(file)) return { xml: fs.readFileSync(file, "utf8"), title: path.basename(file, ".xml") };
  if (!openSpecs) throw new ToolError(`No build named "${want}". Use list_builds, "guide:<name>[:stage]", "last sync", a PoB code or a link.`);
  return { compare: want }; // PoB lists the trees in its error
}

/** Tree plan between any two trees, neither of which has to be open (`a` loads in the side engine). */
export async function pairPlan(pob: Pob, a: unknown, b: unknown): Promise<any> {
  const main = await pob.link().catch(() => null);
  if (a === undefined || a === null || a === "current") {
    if (!main) throw new ToolError("No build is open: give a as well (a build, guide, code or link).");
    return main.call("tree_plan", await treeTarget(pob, main, b));
  }
  const open = async (t: Target): Promise<Target> => {
    if (t.compare === undefined) return t;
    if (!main) throw new ToolError(`"${t.compare}" is a tree of the open build, but no build is open.`);
    return { xml: String((await main.call("export_build_xml")).xml), title: "open build", spec: String(t.compare) };
  };
  const sa = await open(await treeTarget(pob, main, a, false));
  const sb = await open(await treeTarget(pob, main, b, false));
  const side = await pob.sideLink();
  await side.call("load_build_xml", { xml: sa.xml, name: sa.title });
  if (sa.spec) {
    const r = await side.call("select_tree", { spec: sa.spec });
    if (!r.ok) throw new ToolError(r.error);
  }
  const res = await side.call("tree_plan", sb);
  res.base.title = `${sa.title}${sa.spec ? ` / ${res.base.title}` : ""}`;
  return res;
}

const gainText = (g: any) => (g ? `DPS ${pct(g.dpsPct ?? 0)} | EHP ${pct(g.ehpPct ?? 0)} | weakest max hit ${pct(g.hitPct ?? 0)}` : "not simulated");

function rowText(c: any): string {
  const type = (c.ascendancy ? "ascendancy" : String(c.type ?? "").toLowerCase()) + (c.cluster ? ", cluster" : "");
  let what: string;
  if (c.kind === "add") what = `NEW ${c.name} (${type}, ${c.points} point${c.points === 1 ? "" : "s"}${c.effect ? `: ${c.effect}` : ""}${c.jewel ? `, jewel ${c.jewel}` : ""})`;
  else if (c.kind === "remove") what = `REMOVED ${c.name} (${type}, frees ${-c.points})`;
  else if (c.kind === "mastery") what = `MASTERY CHANGED ${c.name}: ${c.oldEffect} -> ${c.newEffect}`;
  else what = `${c.cluster ? "CLUSTER " : ""}JEWEL CHANGED ${c.name}: ${c.oldJewel} -> ${c.newJewel}`;
  const extra = (c.dropped?.length ? ` | also cuts off: ${c.dropped.join(", ")}` : "") + (c.neededBy ? ` | still taken: ${c.neededBy} needs it` : "")
    + (c.needs?.length ? ` | after ${c.needs.join(", ")}` : "");
  const gain = c.notSimulated ? "not simulated (another class, ascendancy or build's jewel)" : gainText(c.gain);
  return ` ${c.order ?? "-"}. [${c.ticked ? "x" : " "}] ${c.id} ${what}: ${gain}${extra}${c.note ? ` | note: ${c.note}` : ""}`;
}

/** The respec cost summary and the ticked set, as the panel's top shows them. */
export function planSummary(res: any): string[] {
  const p = res.plan ?? {};
  const L = [`RESPEC: ${p.regrets} Orb${p.regrets === 1 ? "" : "s"} of Regret (one per refunded passive point); points ${p.pointsBefore} -> ${p.pointsUsed} of ${p.pointsAvailable} at this level`];
  if (p.pointsUsed > p.pointsAvailable) L.push(`  Uses ${p.pointsUsed - p.pointsAvailable} more point${p.pointsUsed - p.pointsAvailable === 1 ? "" : "s"} than the character has.`);
  if (p.masterySwaps) L.push(`  Mastery effects swapped: ${p.masterySwaps} (cost not counted here).`);
  if (p.ascRefunded) L.push(`  Ascendancy points refunded: ${p.ascRefunded} (cost not counted here).`);
  const total = (res.changes ?? []).length;
  L.push(`CHOSEN (${p.ticked} of ${total} changes, together): ${gainText(p.gain)} (DPS ${n(dpsOf(p.before))} -> ${n(dpsOf(p.after))}, EHP ${n(p.before?.TotalEHP)} -> ${n(p.after?.TotalEHP)})`);
  const W = (p.warnings ?? []) as any[];
  L.push(...(W.length ? ["WARNINGS (same checks as what_if):", ...W.map((w) => ` - ${w.text}`)] : ["No warnings: mana, reservation, attributes, resistance caps and immunities hold."]));
  return L;
}

const dpsOf = (s: any) => (s?.FullDPS > 0 ? s.FullDPS : s?.CombinedDPS ?? s?.TotalDPS ?? 0);

export function planText(res: any): string {
  const L = [`TREE PLAN: ${res.base.title} (active tree) -> ${res.other.title}${res.other.source === "build" ? " (another build)" : ""}`];
  if (res.classDiffers) L.push("THE CLASS DIFFERS: only the node differences are listed; a respec cannot change the class.");
  if (res.note) L.push(`Note: ${res.note}.`);
  if (!res.changes?.length) return [...L, "The trees are the same."].join("\n");
  const rows = [...res.changes].sort((x: any, y: any) => (x.order ?? 1e9) - (y.order ?? 1e9));
  L.push(...planSummary(res), "", `CHANGES in the order to take them (best gain per point or Orb of Regret first, after what they need); gains are each alone, ${res.baseline.replace(/^each change alone, /, "")}:`, ...rows.map(rowText));
  if (res.unknownSkip?.length) L.push(`Unknown change ids in skip (ignored): ${res.unknownSkip.join(", ")}.`);
  if (res.saved) L.push(`Saved the ticked set as tree ${res.saved.index} "${res.saved.title}" (not active; the player's tree is unchanged; save_build keeps it in a file).`);
  if (res.rolledBack === false) L.push("WARNING: the build was not restored exactly after measuring. Tell the player; Ctrl+Z in PoB fixes it.");
  L.push("", "Untick: compare { tree, skip: [ids] }; keep: save_as or edit {op:\"apply_tree\",tree,only} (a new tree). On the tree: set_view { view: \"TREE\", compare }.",
    "Orb of Regret = one passive refund point (poewiki, Orb of Regret, 3.29; may be outdated).", `Config assumptions: ${res.assumptions}`);
  return L.join("\n");
}

export const changeCount = (res: any) => `${res.changes?.length ?? 0} change${res.changes?.length === 1 ? "" : "s"}`;
