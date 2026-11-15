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
import { buildFile, currentBuildsDir } from "./session.js";

type Link = Awaited<ReturnType<Pob["link"]>>;

/** The previous character sync of the open build's character: its saved XML and a title. */
export function lastSyncXml(buildName: string | undefined, characterHash: string | undefined): { xml: string; title: string } {
  const all = listHistories();
  const hit = all.find((h) => characterHash && h.history.characterHash === characterHash) ?? all.find((h) => buildName && h.history.build === buildName);
  if (!hit) throw new ToolError("No character sync matches this build. Sync the character first (character { account, character }).");
  const dir = hit.file.replace(/\.json$/, "");
  const snaps = hit.history.entries.filter((e) => e.snapshot && fs.existsSync(path.join(dir, e.snapshot))).reverse();
  if (!snaps.length) throw new ToolError(`No saved sync snapshot for ${hit.history.character}; sync again to make one.`);
  // The synced build itself is the newest sync: compare with the one before it.
  const pick = hit.history.build === buildName && snaps[1] ? snaps[1] : snaps[0];
  return { xml: fs.readFileSync(path.join(dir, pick.snapshot!), "utf8"), title: `Last sync ${pick.at.replace("T", " ").slice(0, 16)}` };
}

/** What tree_plan / the Tree tab compare with: a spec of the open build, another build or the last sync. */
export async function treeTarget(pob: Pob, link: Link, ref: unknown): Promise<Record<string, unknown>> {
  if (typeof ref === "number" || (typeof ref === "string" && /^\d+$/.test(ref.trim()))) return { compare: Number(ref) };
  const want = String(ref ?? "").trim();
  if (!want) throw new ToolError('compare needs a tree number or title, a build name or "last sync".');
  if (/^(the )?(last|previous) sync$/i.test(want)) {
    const ks = await link.call("key_stats");
    return lastSyncXml(ks.name, ks.characterHash);
  }
  const specs = ((await link.call("list_specs")).result?.specs ?? []) as any[];
  if (specs.some((s) => String(s.title ?? "").toLowerCase() === want.toLowerCase())) return { compare: want };
  const file = buildFile(await currentBuildsDir(pob), want);
  if (fs.existsSync(file)) return { xml: fs.readFileSync(file, "utf8"), title: path.basename(file, ".xml") };
  return { compare: want }; // PoB lists the trees in its error
}

const gainText = (g: any) => (g ? `DPS ${pct(g.dpsPct ?? 0)} | EHP ${pct(g.ehpPct ?? 0)} | weakest max hit ${pct(g.hitPct ?? 0)}` : "not simulated");

function rowText(c: any): string {
  const type = c.ascendancy ? "ascendancy" : String(c.type ?? "").toLowerCase();
  let what: string;
  if (c.kind === "add") what = `NEW ${c.name} (${type}, ${c.points} point${c.points === 1 ? "" : "s"}${c.effect ? `: ${c.effect}` : ""}${c.jewel ? `, jewel ${c.jewel}` : ""})`;
  else if (c.kind === "remove") what = `REMOVED ${c.name} (${type}, frees ${-c.points})`;
  else if (c.kind === "mastery") what = `MASTERY CHANGED ${c.name}: ${c.oldEffect} -> ${c.newEffect}`;
  else what = `JEWEL CHANGED ${c.name}: ${c.oldJewel} -> ${c.newJewel}${c.notSimulated ? " (jewel from the other build: not simulated)" : ""}`;
  const extra = (c.dropped?.length ? ` | also cuts off: ${c.dropped.join(", ")}` : "") + (c.neededBy ? ` | still taken: ${c.neededBy} needs it` : "");
  return ` [${c.ticked ? "x" : " "}] ${c.id} ${what}: ${gainText(c.gain)}${extra}${c.note ? ` | note: ${c.note}` : ""}`;
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
  if (res.note) L.push(`Note: ${res.note}.`);
  if (!res.changes?.length) return [...L, "The trees are the same."].join("\n");
  L.push(...planSummary(res), "", `CHANGES (each alone, ${res.baseline.replace(/^each change alone, /, "")}):`, ...res.changes.map(rowText));
  if (res.unknownSkip?.length) L.push(`Unknown change ids in skip (ignored): ${res.unknownSkip.join(", ")}.`);
  if (res.saved) L.push(`Saved the ticked set as tree ${res.saved.index} "${res.saved.title}" (not active; the player's tree is unchanged; save_build keeps it in a file).`);
  if (res.rolledBack === false) L.push("WARNING: the build was not restored exactly after measuring. Tell the player; Ctrl+Z in PoB fixes it.");
  L.push("", "Untick: compare { tree, skip: [ids] }; keep: save_as. On the tree: set_view { view: \"TREE\", compare }.",
    "Orb of Regret = one passive refund point (poewiki, Orb of Regret, 3.29; may be outdated).", `Config assumptions: ${res.assumptions}`);
  return L.join("\n");
}

export const changeCount = (res: any) => `${res.changes?.length ?? 0} change${res.changes?.length === 1 ? "" : "s"}`;
