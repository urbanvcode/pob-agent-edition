/** Guide mode tools: guide_import, guide_compare, guide_next_steps (Stage 3). */
import fs from "fs";
import path from "path";
import { n } from "../format.js";
import {
  dpsOf, download, gainText, headline, itemName, mergeStages, ninjaPrice, parseBudget, parseSources, rawUrl,
  readState, tradeLink, value, value as valueOf, withSourceNote, writeCard, writeState, type Gain, type GuideChoice, type LightStage,
} from "../guideMode.js";
import { ToolError, type Pob } from "../pob.js";
import { getProfile } from "../profile.js";
import { S, tool, type Args, type Context, type Tool } from "../registry.js";
import { currencyRates } from "../trade/ninja.js";
import { buildFile, currentBuildsDir, decodeBuildCode } from "./session.js";
import { resolveLeague } from "./trade.js";

const GAP_TIMEOUT = 240_000;

// --- guides on disk -------------------------------------------------------------------
function guideFiles(dir: string): Array<{ name: string; file: string; mtime: number }> {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { /* no folder */ }
  return names.filter((f) => /^Guide - .*\.xml$/i.test(f))
    .map((f) => ({ name: f.replace(/\.xml$/i, ""), file: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function findGuide(dir: string, name: string): string {
  const clean = name.trim().replace(/\.xml$/i, "");
  for (const candidate of [clean, `Guide - ${clean}`]) {
    const file = buildFile(dir, candidate);
    if (fs.existsSync(file)) return file;
  }
  const hit = guideFiles(dir).find((g) => g.name.toLowerCase().includes(clean.toLowerCase()));
  if (hit) return hit.file;
  throw new ToolError(`No guide "${name}" in ${dir}. Guides: ${guideFiles(dir).map((g) => g.name).join(", ") || "none yet (use guide { source })"}.`);
}

// --- the guide build, read in the side engine (never the player's window) ------------
const guideCache = new Map<string, { stages: LightStage[]; meta: any; data: Map<number, any> }>();

async function guideInfo(pob: Pob, file: string) {
  const key = `${file}|${fs.statSync(file).mtimeMs}`;
  let entry = guideCache.get(key);
  if (!entry) {
    const side = await pob.sideLink();
    await side.call("load_build_xml", { xml: fs.readFileSync(file, "utf8"), name: path.basename(file, ".xml") });
    const meta = await side.call("guide_stages", { all: true });
    entry = { stages: meta.stages, meta, data: new Map() };
    guideCache.set(key, entry);
  }
  return { key, ...entry };
}

async function guideStageData(pob: Pob, file: string, index: number): Promise<any> {
  const info = await guideInfo(pob, file);
  let data = info.data.get(index);
  if (!data) {
    const side = await pob.sideLink();
    await side.call("load_build_xml", { xml: fs.readFileSync(file, "utf8"), name: path.basename(file, ".xml") });
    data = await side.call("guide_data", { stage: index });
    info.data.set(index, data);
  }
  return data;
}

function pickStage(stages: LightStage[], wanted: string | undefined): LightStage | undefined {
  if (!wanted) return undefined;
  const w = wanted.trim().toLowerCase();
  if (/^\d+$/.test(w)) return stages.find((s) => s.index === Number(w));
  return stages.find((s) => s.title.toLowerCase() === w) ?? stages.find((s) => s.title.toLowerCase().includes(w));
}

// --- one analysis, shared by compare and next steps -----------------------------------
interface Analysis {
  file: string; guideName: string; stage: LightStage; stages: LightStage[]; detected: { index: number; reason: string; levelling?: boolean };
  stageReason: string; choice: GuideChoice; player: string; gap: any; guide: any; live: boolean;
}
const gapCache = new Map<string, { at: number; gap: any }>();

async function analyse({ pob }: Context, args: Args): Promise<Analysis> {
  const link = await pob.link();
  const me = await link.call("guide_stages", {});
  const player = String(me.name ?? "Build");
  const dir = await currentBuildsDir(pob);
  const state = readState();
  const prev = state.builds[player];
  let file: string;
  if (typeof args.guide === "string" && args.guide.trim()) file = findGuide(dir, args.guide);
  else if (prev?.guide && fs.existsSync(buildFile(dir, prev.guide))) file = buildFile(dir, prev.guide);
  else if (state.last && fs.existsSync(buildFile(dir, state.last))) file = buildFile(dir, state.last);
  else {
    const newest = guideFiles(dir)[0];
    if (!newest) throw new ToolError("No guide imported yet. Ask the player for the guide's PoB link or code, then guide { source }.");
    file = newest.file;
  }
  const guideName = path.basename(file, ".xml");
  const choice: GuideChoice = prev && prev.guide === guideName ? { ...prev, accept: [...prev.accept] } : { guide: guideName, accept: [] };
  const norm = (list: unknown) => (Array.isArray(list) ? list.map((x) => String(x).trim()).filter(Boolean) : []);
  for (const a of norm(args.accept)) if (!choice.accept.some((x) => x.toLowerCase() === a.toLowerCase())) choice.accept.push(a);
  const drop = norm(args.unaccept).map((x) => x.toLowerCase());
  choice.accept = choice.accept.filter((x) => !drop.includes(x.toLowerCase()));

  const info = await guideInfo(pob, file);
  const stages = info.stages;
  const mine = me.stages?.[0] as LightStage;
  const detected = await link.call("guide_detect", { stages, me: mine, level: me.level ?? 1, pointsAtLevel: me.pointsAtLevel ?? 0 }) as any;
  let stage: LightStage | undefined;
  let stageReason: string;
  const asked = typeof args.stage === "string" || typeof args.stage === "number" ? String(args.stage) : undefined;
  if (asked && asked.toLowerCase() !== "auto") {
    stage = pickStage(stages, asked);
    if (!stage) throw new ToolError(`No stage "${asked}". Stages: ${stages.map((s) => `${s.index} ${s.title}`).join(", ")}.`);
    choice.stage = stage.title;
    stageReason = "chosen";
  } else {
    if (asked) delete choice.stage;
    stage = choice.stage ? pickStage(stages, choice.stage) : undefined;
    stageReason = stage ? "remembered" : "detected";
    stage ??= stages.find((s) => s.index === detected.index) ?? stages[0];
  }
  state.builds[player] = choice;
  state.last = guideName;
  writeState(state);

  const guide = await guideStageData(pob, file, stage.index);
  const statsNow = await link.call("key_stats");
  const key = JSON.stringify([info.key, stage.index, choice.accept, player, statsNow.stats, link.kind]);
  let cached = gapCache.get(key);
  if (!cached || Date.now() - cached.at > 600_000) {
    const profile = getProfile().profile;
    const gap = await link.call("guide_gap", {
      guide, skip: choice.accept, levelling: stage.levelling === true, hardcore: profile.hardcore,
      league: profile.league || undefined, playMode: profile.playMode,
    }, GAP_TIMEOUT);
    cached = { at: Date.now(), gap };
    gapCache.set(key, cached);
  }
  return { file, guideName, stage, stages, detected, stageReason, choice, player, gap: cached.gap, guide, live: link.kind === "live" };
}

// --- text -----------------------------------------------------------------------------------
const pctOf = (have: number, total: number) => (total > 0 ? Math.round((have / total) * 100) : 100);

function matchNumbers(gap: any) {
  return {
    passives: [gap.tree.have ?? 0, gap.tree.total ?? 0],
    gems: [gap.gems.have ?? 0, gap.gems.total ?? 0],
    items: [gap.items.have ?? 0, gap.items.total ?? 0],
  };
}

function stageLine(a: Analysis): string {
  const top = a.stages.find((s) => s.index === a.detected.index);
  const det = top ? `closest stage: ${top.index} "${top.title}" (${a.detected.reason})` : "";
  const mode = a.gap.levelling ? " LEVELLING mode (campaign rules)" : "";
  return `GUIDE "${a.guideName}", stage ${a.stage.index}/${a.stages.length} "${a.stage.title}" (${a.stageReason}); ${det}.${mode}`;
}

/** What the character lacks most, and the best far-away target. */
function focusLines(a: Analysis): string[] {
  const f = a.gap.focus, plan = a.gap.plan;
  if (!f) return [];
  const L = [`FOCUS: ${f.title} (${(f.reasons ?? []).join("; ")}). Gains are weighed DPS x${f.wDps}, EHP x${f.wEhp}${Object.keys(f.resMissing ?? {}).length ? ", plus missing resistance" : ""}.`];
  if (plan?.rush) L.push(`RUSH: ${plan.rush.target}, ${plan.rush.points} points with its path: DPS ${plan.rush.dpsPct >= 0 ? "+" : ""}${plan.rush.dpsPct.toFixed(1)}%, EHP ${plan.rush.ehpPct >= 0 ? "+" : ""}${plan.rush.ehpPct.toFixed(1)}% (best gain per point among targets 3+ points away).`);
  return L;
}

/** Levelling: the skills the guide's next stage brings, with the level they need. */
function nextStageLines(a: Analysis): string[] {
  if (!a.gap.levelling) return [];
  const L = ["Levelling: Act 5 and Act 10 each lower your resistances by 30%; cap them again after each."];
  const next = a.stages.find((s) => s.index === a.stage.index + 1);
  if (next) {
    const now = new Set((a.stage.skills ?? []).map((x) => x.name.toLowerCase()));
    const fresh = (next.skills ?? []).filter((x) => !now.has(x.name.toLowerCase()));
    if (fresh.length) L.push(`Next stage "${next.title}" (${next.points} points) uses: ${fresh.map((x) => `${x.name}${x.req ? ` (needs level ${x.req})` : ""}`).join(", ")}.`);
  }
  return L;
}

function compareText(a: Analysis, showNotes: boolean): string {
  const { gap, guide } = a;
  const L: string[] = [stageLine(a)];
  L.push(`Stages: ${a.stages.map((s) => `${s.index} ${s.title}`).join(" | ")}`);
  const m = matchNumbers(gap);
  L.push(`Matched: passives ${m.passives[0]}/${m.passives[1]} (${pctOf(m.passives[0], m.passives[1])}%), gems ${m.gems[0]}/${m.gems[1]} (${pctOf(m.gems[0], m.gems[1])}%), key items ${m.items[0]}/${m.items[1]} (${pctOf(m.items[0], m.items[1])}%)`);
  if (gap.className !== guide.className || gap.ascendancy !== guide.ascendancy) L.push(`NOTE: you are ${gap.ascendancy ?? gap.className}, the guide is ${guide.ascendancy ?? guide.className}.`);
  L.push(...focusLines(a), ...nextStageLines(a));

  L.push("", `HEADLINE (you level ${gap.level}, guide level ${guide.level})`, ...headline(gap.stats, guide.stats));
  const ex = gap.explain;
  if (ex) {
    L.push("", "WHAT EXPLAINS THE GAP (each part of the guide put into your build on its own, PoB-simulated)");
    for (const [k, label] of [["tree", "Passive tree"], ["gems", "Gems"], ["items", "Gear (jewels apart)"], ["config", "Config differences"]] as const) {
      L.push(`- ${label}: ${ex[k] ? gainText(ex[k]) : "no difference"}`);
    }
    if (ex.all && !ex.all.error) {
      const reach = dpsOf(guide.stats) > 0 ? Math.round(((dpsOf(gap.stats) + ex.all.dps) / dpsOf(guide.stats)) * 100) : 0;
      L.push(`- All together: ${gainText(ex.all)} -> ${reach}% of the guide's DPS. The rest: jewels (listed below), character level, gem swaps not tracked here.`);
    }
  }

  const t = gap.tree;
  L.push("", "PASSIVES");
  if (t.classMismatch) L.push(`The guide is a ${t.classMismatch} tree; yours is another class, so passives cannot be compared.`);
  else {
    L.push(`To add: ${t.missingPoints} points${t.unreachable ? ` (${t.unreachable} not reachable from your tree)` : ""}${t.otherAscendancy ? `, ${t.otherAscendancy} of another ascendancy` : ""}${t.notFound ? `, ${t.notFound} cluster-jewel passives` : ""}. You have ${gap.pointsAtLevel - gap.points} unspent of ${gap.pointsAtLevel} at your level.`);
    const steps: any[] = t.steps ?? [];
    if (steps.length) L.push("Path, in order (gain at each step, on top of the steps before):");
    steps.slice(0, 20).forEach((s, i) => {
      const extra = s.moves ? ` (moves it from your ${s.moves})` : s.current ? ` (now: ${s.current}; changing it is a respec, cost not verified)` : "";
      L.push(`${i + 1}. ${s.names.join(", ")} [${s.kind}, ${s.points} pt${s.points === 1 ? "" : "s"}]${extra}: ${s.skippedSim ? `not simulated (${s.skippedSim})` : gainText(s.gain)}`);
    });
    if (steps.length > 20) L.push(`... ${steps.length - 20} more steps`);
    if (t.extra?.length && t.respecIgnored) {
      L.push(`Not in this stage's tree: ${t.extraPoints} points. Levelling: no respec needed; follow the guide's next tree.`);
    } else if (t.extra?.length) {
      L.push(`Not in the guide: ${t.extraPoints} points (respec = 1 Orb of Regret each): ${t.extra.slice(0, 15).map((e: any) => e.name).join(", ")}${t.extra.length > 15 ? ", ..." : ""}`);
      if (t.removeExtra) L.push(`Removing them after the path: ${gainText(t.removeExtra)}`);
    }
  }

  L.push("", "GEMS (per skill group of the guide)");
  for (const g of gap.gems.groups ?? []) {
    const head = `- ${g.skill}${g.main ? " [main]" : ""}${g.slot ? ` (${g.slot})` : ""}`;
    if (g.absent) { L.push(`${head}: missing group, ${g.gems.map((x: any) => x.name).join(" + ")}: ${g.later ? `from level ${g.later}` : gainText(g.gain)}`); continue; }
    const bits: string[] = [];
    if (g.guideCount !== g.playerCount) bits.push(`${g.playerCount} gems, guide ${g.guideCount}`);
    for (const x of g.missing) bits.push(`add ${x.name}${x.replaces ? ` instead of ${x.replaces}` : ""}: ${x.later ? `from level ${x.later}` : gainText(x.gain)}`);
    if (g.wrong.length && !g.missing.length) bits.push(`not in the guide: ${g.wrong.map((w: any) => w.name).join(", ")}`);
    if (g.levels.length) bits.push(`levels ${g.levels.map((l: any) => `${l.name} ${l.from}/${l.qFrom} -> ${l.to}/${l.qTo}`).join(", ")}: ${gainText(g.levelGain)}`);
    if (bits.length) L.push(`${head}: ${bits.join("; ")}`);
  }
  if (!(gap.gems.groups ?? []).some((g: any) => g.absent || g.missing.length || g.levels.length || g.guideCount !== g.playerCount)) L.push("Same gems as the guide.");

  L.push("", "ITEMS (the guide's item put into your build, one slot at a time)");
  for (const s of gap.items.slots ?? []) {
    if (s.status === "match" || s.status === "rare ok") continue;
    const guideItem = itemName(s.guide, s.base, s.rarity);
    if (s.status === "accepted") { L.push(`- ${s.slot}: guide ${guideItem}; your choice is accepted`); continue; }
    if (s.status === "socket not allocated") { L.push(`- ${s.slot}: guide ${guideItem}; take the socket first (it is on the passive path)`); continue; }
    if (s.status === "levelling rare") continue;
    const mods = s.mods?.length && s.status !== "missing unique" ? ` [guide mods: ${s.mods.slice(0, 6).join("; ")}]` : "";
    L.push(`- ${s.slot}: guide ${guideItem}, you ${s.player ? itemName(s.player, s.playerBase, s.playerRarity) : "(empty)"}: ${gainText(s.gain)}${mods}`);
  }
  const ok = (gap.items.slots ?? []).filter((s: any) => s.status === "match" || s.status === "rare ok").map((s: any) => s.slot);
  if (ok.length) L.push(`Matching the guide (or the guide's rare would not add 2%): ${ok.join(", ")}`);
  const lv = (gap.items.slots ?? []).filter((s: any) => s.status === "levelling rare").map((s: any) => s.slot);
  if (lv.length) L.push(`Levelling: the guide's rares (${lv.join(", ")}) only show what to look for (life, resistances, movement speed); links on the main skill matter more.`);

  if (gap.config?.length) {
    L.push("", "CONFIG that differs (changes numbers, not the character; PoB config option = guide / you)");
    L.push(gap.config.slice(0, 20).map((c: any) => `${c.label ? `${c.label} (${c.key})` : c.key} = ${c.guide ?? "off"} / ${c.player ?? "off"}`).join("; "));
  }
  if (a.choice.accept.length) L.push("", `Accepted deviations (not flagged): ${a.choice.accept.join(", ")}`);
  if (showNotes && guide.notes) L.push("", `GUIDE NOTES (${guide.notes.length} characters)`, guide.notes.slice(0, 6000) + (guide.notes.length > 6000 ? "\n... (cut)" : ""));
  else if (guide.notes) L.push("", `The guide has notes (${guide.notes.length} characters: gem swaps, bandit, pantheon, item tips); notes: true shows them.`);
  L.push("", `Config assumptions (your build): ${a.gap.assumptionsText ?? "see stats"}`);
  return L.join("\n");
}

// --- next steps -----------------------------------------------------------------------------
interface Step {
  kind: "passives" | "mastery" | "gem" | "gem levels" | "skill group" | "item" | "jewel";
  text: string; gain: Gain; points?: number; chaos?: number; price?: string; link?: string; view: string; after?: number; idx?: number; needsPrice?: boolean;
}

async function rankSteps(ctx: Context, a: Analysis, budgetText: unknown, limit: number) {
  const profile = getProfile().profile;
  const hardcore = profile.hardcore;
  const mode = profile.playMode;
  const notes: string[] = [];
  let league = profile.league;
  let rates = new Map<string, number>([["Chaos Orb", 1]]);
  if (mode !== "ssf") try {
    league = (await resolveLeague(ctx.trade, undefined)).league;
    rates = await currencyRates(league);
  } catch (e) {
    notes.push(`Prices unavailable (${e instanceof Error ? e.message : String(e)}); items are ranked by gain only.`);
  }
  const divine = rates.get("Divine Orb") ?? 0;
  let budget: number | undefined;
  if (typeof budgetText === "string" && budgetText.trim()) {
    budget = parseBudget(budgetText, divine);
    if (budget === undefined) throw new ToolError(`Budget "${budgetText}" not understood: use e.g. "150c" or "2 div".`);
    if (/d/i.test(budgetText) && !divine) throw new ToolError("No Divine Orb rate from poe.ninja right now: give the budget in chaos.");
  } else if (profile.currency.chaos || profile.currency.divine) {
    budget = profile.currency.chaos + profile.currency.divine * divine;
  }

  const gap = a.gap;
  const steps: Step[] = [];
  (gap.tree.steps ?? []).forEach((s: any, i: number) => {
    if (!s.gain || s.skippedSim) return;
    steps.push({ kind: s.mastery ? "mastery" : "passives", idx: i + 1, after: s.after, points: s.points, gain: s.gain, view: "TREE",
      text: `${s.names.join(", ")} (${s.points} pt${s.points === 1 ? "" : "s"}${s.current ? ", swaps your mastery choice; respec cost not verified" : ""})` });
  });
  const gemPrice = async (name: string) => {
    if (mode === "ssf") return undefined;
    try { return await ninjaPrice(league, name, "gem"); } catch { return undefined; }
  };
  for (const g of gap.gems.groups ?? []) {
    if (g.absent && g.gain) {
      steps.push({ kind: "skill group", gain: g.gain, view: "SKILLS", text: `New skill group ${g.gems.map((x: any) => x.name).join(" + ")}${g.slot ? ` in ${g.slot}` : ""}` });
      continue;
    }
    for (const x of g.missing) {
      if (!x.gain) continue;
      const p = await gemPrice(x.name);
      steps.push({ kind: "gem", gain: x.gain, view: "SKILLS", chaos: p?.chaos, price: p ? `${n(p.chaos)}c (poe.ninja)` : undefined,
        link: mode !== "ssf" && league ? tradeLink(league, { type: p?.name ?? x.name }) : undefined,
        text: `${x.name} in ${g.skill}${x.replaces ? ` (instead of ${x.replaces})` : ""}` });
    }
    if (g.levelGain && g.levels.length) {
      steps.push({ kind: "gem levels", gain: g.levelGain, view: "SKILLS", text: `Level/quality ${g.levels.map((l: any) => `${l.name} to ${l.to}/${l.qTo}`).join(", ")}` });
    }
  }
  for (const s of gap.items.slots ?? []) {
    if (!s.gain || s.gain.error || ["match", "rare ok", "accepted", "socket not allocated"].includes(s.status)) continue;
    const jewel = /^Jewel/.test(s.slot);
    const step: Step = { kind: jewel ? "jewel" : "item", gain: s.gain, view: "ITEMS", text: `${s.slot}: ${itemName(s.guide, s.base, s.rarity)}` };
    if (s.rarity === "UNIQUE") {
      const name = String(s.guide).split(",")[0].trim();
      if (mode !== "ssf") {
        try {
          const p = await ninjaPrice(league, name, "unique", s.slot);
          if (p) { step.chaos = p.chaos; step.price = `${n(p.chaos)}c${divine && p.chaos >= divine ? ` (${n(p.chaos / divine, 1)} div)` : ""} (poe.ninja)`; }
          else step.needsPrice = true;
        } catch { step.needsPrice = true; }
        step.link = tradeLink(league, { name, type: s.base });
      }
    } else {
      step.needsPrice = true;
      if (s.mods?.length) step.text += ` with ${s.mods.slice(0, 4).join("; ")}`;
    }
    steps.push(step);
  }

  // PoB weighs every gain by what the character lacks most (gap.focus); score is that weighted value.
  const score = (s: Step) => (s.gain as any).score ?? value(s.gain, hardcore);
  const free = gap.pointsAtLevel - gap.points;
  const perPoint = (s: Step) => score(s) / Math.max(1, s.points ?? 1);
  // Passives in PoB's order: best per point first, each after the step it builds on.
  const passivePlan: Step[] = (gap.plan?.passives ?? [])
    .map((p: any) => steps.find((s) => s.idx === p.idx))
    .filter((s: Step | undefined): s is Step => !!s && score(s) > 0);
  const pending = [...passivePlan].sort((x, y) => perPoint(y) - perPoint(x));
  const levelling = gap.levelling === true;
  // Levelling: no price ranking, just the best gains; endgame: gain per chaos.
  const buys = steps.filter((s) => s.chaos !== undefined && score(s) > 0)
    .sort((x, y) => (levelling ? score(y) - score(x) : score(y) / Math.max(1, y.chaos!) - score(x) / Math.max(1, x.chaos!)));
  const other = steps.filter((s) => (s.kind === "gem levels" || s.kind === "skill group" || (s.kind === "gem" && s.chaos === undefined && !s.needsPrice) || (mode === "ssf" && (s.kind === "item" || s.kind === "jewel")))
    && score(s) > 0).sort((x, y) => score(y) - score(x));
  const priceCheck = mode === "ssf" ? [] : steps.filter((s) => s.needsPrice && score(s) > 0).sort((x, y) => score(y) - score(x));
  const negative = steps.filter((s) => score(s) <= 0 && (s.kind === "item" || s.kind === "jewel"));

  let spent = 0;
  const inBudget: Step[] = [], over: Step[] = [];
  for (const s of buys) {
    if (levelling || budget === undefined || spent + s.chaos! <= budget) { inBudget.push(s); spent += s.chaos!; } else over.push(s);
  }
  const regret = rates.get("Orb of Regret");
  const respec = gap.tree.extraPoints > 0 && !levelling ? { points: gap.tree.extraPoints, chaos: regret ? regret * gap.tree.extraPoints : undefined } : undefined;
  return { respec, levelling, topPassive: pending[0] as Step | undefined, passivePlan, free, buys: inBudget, over, other, priceCheck, negative, budget, spent, divine, league, mode, hardcore, notes, limit };
}

function stepLine(i: number, s: Step): string {
  const cost = s.price ? `, ${s.price}` : "";
  const warn = s.gain.ehpPct < -2 ? " [lowers EHP]" : "";
  return `${i}. ${s.text}: ${gainText(s.gain)}${cost}${warn}${s.link ? `\n   ${s.link}` : ""}`;
}

function nextStepsText(a: Analysis, r: Awaited<ReturnType<typeof rankSteps>>): string {
  const L: string[] = [stageLine(a)];
  const budget = r.budget === undefined ? "no budget set" : `budget ${n(r.budget)}c${r.divine ? ` (${n(r.budget / r.divine, 2)} div)` : ""}`;
  L.push(`Mode: ${r.mode}${r.hardcore ? ", hardcore" : ""}; ${r.levelling ? "levelling (no budget ranking)" : budget}; league ${r.league || "?"}. Gains are PoB simulations in your build.`);
  L.push(...focusLines(a), ...nextStageLines(a));
  L.push("", `1) PASSIVES (free: ${r.free} unspent point${r.free === 1 ? "" : "s"}; ${r.levelling ? "the next ones come with levels" : "later points come with levels, or 1 Orb of Regret per respecced point"})`);
  if (!r.passivePlan.length) L.push("Nothing on the path adds DPS or EHP right now.");
  if (r.respec) L.push(`Respec to follow the guide's tree: ${r.respec.points} of your points are not in it = ${r.respec.points} Orbs of Regret${r.respec.chaos !== undefined ? ` (about ${n(r.respec.chaos)}c, poe.ninja)` : ""}.`);
  let used = 0;
  r.passivePlan.slice(0, r.limit).forEach((s, i) => {
    used += s.points ?? 0;
    L.push(`${stepLine(i + 1, s)}${used > r.free ? " [needs more points]" : ""}`);
  });
  if (r.mode === "ssf") {
    L.push("", "2) SSF TARGETS (craft, farm or drop; ranked by gain)");
    r.other.slice(0, r.limit).forEach((s, i) => L.push(stepLine(i + 1, s)));
  } else {
    L.push("", r.levelling ? "2) LEVELLING UNIQUES (instant buyout; ranked by gain; levelling uniques are usually cheap)" : `2) BUY (instant buyout; ranked by gain per chaos${r.budget !== undefined ? `; ${n(r.spent)}c of ${n(r.budget)}c used` : ""})`);
    if (!r.buys.length) L.push(r.budget !== undefined ? "Nothing with a known price fits the budget." : "No priced upgrades.");
    r.buys.slice(0, r.limit).forEach((s, i) => L.push(stepLine(i + 1, s)));
    if (r.over.length) L.push(`Over budget: ${r.over.slice(0, 5).map((s) => `${s.text} (${s.price}; ${gainText(s.gain)})`).join(" | ")}`);
    if (r.mode === "mixed") L.push("[SSF] the same items are drop/farm targets; passives and gem levels cost no currency.");
    const extra = r.other.filter((s) => s.kind !== "item" && s.kind !== "jewel");
    if (extra.length) {
      L.push("", "3) NO CURRENCY NEEDED (vendor gems, levelling, new skill groups)");
      extra.slice(0, r.limit).forEach((s, i) => L.push(stepLine(i + 1, s)));
    }
    if (r.priceCheck.length) {
      L.push("", "NEEDS A PRICE (guide rares or unlisted items; trade_search with the slot, or plan_upgrades, prices them)");
      r.priceCheck.slice(0, r.limit).forEach((s, i) => L.push(stepLine(i + 1, s)));
    }
  }
  if (r.negative.length) L.push("", `Guide items that lower your numbers right now (they need the rest of the guide first, or config such as kills/flasks): ${r.negative.map((s) => `${s.text.split(" with ")[0]} (${gainText(s.gain)})`).join(" | ")}`);
  if (r.notes.length) L.push("", ...r.notes);
  L.push("", "Not happy with a guide choice? guide with accept stops flagging it.");
  return L.join("\n");
}

function cardFrom(a: Analysis, next: Step[]): unknown {
  const m = matchNumbers(a.gap);
  return {
    build: a.player, guide: a.guideName, stage: a.stage.title, stageIndex: a.stage.index, stages: a.stages.length, reason: a.stageReason,
    detected: a.stages.find((s) => s.index === a.detected.index)?.title, at: new Date().toISOString(), match: m,
    focus: a.gap.focus?.title, levelling: a.gap.levelling === true,
    rush: a.gap.plan?.rush ? { target: a.gap.plan.rush.target, points: a.gap.plan.rush.points, dpsPct: a.gap.plan.rush.dpsPct, ehpPct: a.gap.plan.rush.ehpPct } : undefined,
    dps: [dpsOf(a.gap.stats), dpsOf(a.guide.stats)], ehp: [a.gap.stats.TotalEHP ?? 0, a.guide.stats.TotalEHP ?? 0],
    next: next.slice(0, 3).map((s) => ({ text: s.text, kind: s.kind, view: s.view, dpsPct: s.gain.dpsPct, ehpPct: s.gain.ehpPct, price: s.price, link: s.link })),
  };
}

/** Steps for the card: without a ranking, the best of each kind by gain. */
function quickNext(a: Analysis, hardcore: boolean): Step[] {
  const value = (g: any, hc: boolean) => g?.score ?? valueOf(g, hc);
  const list: Step[] = [];
  const tree = (a.gap.tree.steps ?? []).filter((s: any) => s.gain && value(s.gain, hardcore) > 0)
    .map((s: any) => ({ kind: "passives", text: s.names.join(", "), gain: s.gain, view: "TREE" } as Step));
  const gems = (a.gap.gems.groups ?? []).flatMap((g: any) => (g.missing ?? []).filter((x: any) => x.gain).map((x: any) => ({ kind: "gem", text: `${x.name} in ${g.skill}`, gain: x.gain, view: "SKILLS" } as Step)));
  const items = (a.gap.items.slots ?? []).filter((s: any) => s.gain && !["match", "rare ok", "accepted", "socket not allocated"].includes(s.status))
    .map((s: any) => ({ kind: "item", text: `${s.slot}: ${itemName(s.guide, s.base, s.rarity)}`, gain: s.gain, view: "ITEMS" } as Step));
  for (const group of [tree, gems, items]) list.push(...group.filter((s: Step) => value(s.gain, hardcore) > 0));
  return list.sort((x, y) => value(y.gain, hardcore) - value(x.gain, hardcore));
}

async function assumptionsOf(ctx: Context): Promise<string> {
  try { return String((await (await ctx.pob.link()).call("key_stats")).assumptions ?? ""); } catch { return ""; }
}

export const guideTools: Tool[] = [
  tool("guide_import", 'Import a build guide (PoB code, or a pobb.in / poe.ninja / pastebin / maxroll link) as a new "Guide - <name>" build; its loadouts are the stages. Several stage builds: one "Stage: link" per line. The open build is not touched.',
    { source: S.str(), name: S.str() }, ["source"],
    async ({ pob }, args) => {
      const sources = parseSources(String(args.source ?? ""));
      if (!sources.length) throw new ToolError("source is empty: give the guide's PoB link or code.");
      if (sources.length > 8) throw new ToolError("At most 8 stage links per import.");
      const parts: Array<{ stage: string; xml: string }> = [];
      for (const [i, s] of sources.entries()) {
        const url = rawUrl(s.ref);
        const xml = decodeBuildCode(url ? await download(url) : s.ref);
        if (!/<PathOfBuilding\b/.test(xml)) throw new ToolError(`${s.ref.slice(0, 60)} is not a PoB build.`);
        parts.push({ stage: s.stage ?? `Stage ${i + 1}`, xml });
      }
      let xml = parts.length > 1 ? mergeStages(parts) : parts[0].xml;
      xml = withSourceNote(xml, sources.map((s) => (/^https?:/i.test(s.ref) ? s.ref : "a PoB code")));
      const side = await pob.sideLink();
      await side.call("load_build_xml", { xml, name: "Guide" });
      const meta = await side.call("guide_stages", { all: true });
      const ks = await side.call("key_stats");
      const dir = await currentBuildsDir(pob);
      const base = String(args.name ?? "").trim().replace(/^Guide - /i, "") || `${meta.ascendancy && meta.ascendancy !== "None" ? meta.ascendancy : meta.className} ${ks.mainSkill ?? ""}`.trim();
      let file = buildFile(dir, `Guide - ${base}`);
      for (let k = 2; fs.existsSync(file); k++) file = buildFile(dir, `Guide - ${base} (${k})`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, xml, "utf8");
      const name = path.basename(file, ".xml");
      const state = readState();
      state.last = name;
      writeState(state);
      const notes = (/<Notes\b[^>]*>([\s\S]*?)<\/Notes>/.exec(xml)?.[1] ?? "").replace(/\^x[0-9A-Fa-f]{6}|\^\d/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
      return [
        `Saved the guide as "${name}" (${file}). Your open build was not changed.`,
        `${meta.ascendancy ?? meta.className}, level ${meta.level}, main skill ${ks.mainSkill ?? "?"}.`,
        `Stages (${meta.stages.length}): ${meta.stages.map((s: any) => `${s.index} ${s.title} (${s.points} pts)`).join(" | ")}`,
        notes ? `Guide notes (start; guide with notes: true shows all):\n${notes.slice(0, 700)}${notes.length > 700 ? " ..." : ""}` : "The guide has no notes.",
        "Next: guide (it detects the stage your character is at).",
      ].join("\n");
    }),

  tool("guide_compare", "Me vs guide stage: passives as an ordered path, masteries, gems, items, config, headline numbers and what explains the gap, all simulated in the open build. Remembers guide, stage and accepted deviations. Updates the Overview Guide card.",
    { guide: S.str("Default: last used"), stage: S.str("Title or number; \"auto\" detects"), accept: S.list(S.str(), "Deliberate deviations (slot, item, gem or passive names): never flagged again"), unaccept: S.list(S.str()), notes: S.bool("Add the guide's notes") }, [],
    async (ctx, args) => {
      const a = await analyse(ctx, args);
      a.gap.assumptionsText = await assumptionsOf(ctx);
      try { writeCard(cardFrom(a, quickNext(a, getProfile().profile.hardcore))); } catch { /* the card is optional */ }
      return compareText(a, args.notes === true) + (a.live ? "\nAlso on the Overview tab (Guide card)." : "");
    }),

  tool("guide_next_steps", "Top actions toward the guide stage, ranked by simulated gain per cost (passive points, chaos), within a budget and the profile's trade/SSF mode, with trade links. Updates the Overview Guide card.",
    { budget: S.str('e.g. "2 div" or "150c"; default: currency on hand'), limit: S.num() }, [],
    async (ctx, args) => {
      const a = await analyse(ctx, {});
      const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 15);
      const r = await rankSteps(ctx, a, args.budget, limit);
      const next = [...(r.topPassive ? [r.topPassive] : []), ...(r.mode === "ssf" ? r.other : r.buys).slice(0, 1), ...r.other.slice(0, 1), ...r.buys, ...r.passivePlan].filter((s, i, arr) => arr.indexOf(s) === i);
      try { writeCard(cardFrom(a, next.length ? next : quickNext(a, r.hardcore))); } catch { /* the card is optional */ }
      return nextStepsText(a, r);
    }),
];
