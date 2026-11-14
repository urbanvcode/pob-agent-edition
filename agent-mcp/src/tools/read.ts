/** Read tools: build_summary, stats, diagnose, tree_search. Numbers come from PoB's own calculation. */
import { n, statLines } from "../format.js";
import { ToolError } from "../pob.js";
import { S, tool, type Tool } from "../registry.js";

const ASSUME = (text: string) => `Config assumptions: ${text}`;

function gemText(g: { name: string; level: number; quality: number; socketQuality?: number; enabled: boolean }): string {
  // The game's gem tooltip shows own + socket quality as one number ("augmented").
  return `${g.name} ${g.level}/${g.quality}${g.socketQuality ? `+${g.socketQuality} socket` : ""}${g.enabled ? "" : " (off)"}`;
}

export function summaryText(s: any, parts: Set<string>, detail: boolean): string {
  const lines: string[] = [];
  lines.push(`${s.name ?? "Build"}: level ${s.level} ${s.className}${s.ascendancy && s.ascendancy !== "None" ? ` (${s.ascendancy})` : ""}, main skill ${s.mainSkill ?? "none"}`);
  if (parts.has("skills")) {
    lines.push("", "SKILLS (group: gems level/quality; +N socket = quality from a matching socket colour, already counted: the game shows the sum)");
    for (const g of s.groups ?? []) {
      const tags = [g.index === s.mainSocketGroup ? "MAIN" : "", g.enabled ? "" : "off", g.fullDps ? "in Full DPS" : "", g.slot ?? "", g.label ?? ""].filter(Boolean).join(", ");
      lines.push(`${g.index}${tags ? ` [${tags}]` : ""}: ${(g.gems ?? []).map((gem: any, i: number) => `${i + 1}.${gemText(gem)}`).join(" | ") || "(empty)"}`);
    }
  }
  if (parts.has("items")) {
    lines.push("", "ITEMS (slot: item)");
    for (const it of s.items ?? []) {
      if (!it.name) { lines.push(`${it.slot}: (empty)`); continue; }
      const flask = it.active === true ? " [flask on]" : it.active === false && /^Flask/.test(it.slot) ? " [flask off]" : "";
      lines.push(`${it.slot}: ${it.name}${it.base && !String(it.name).includes(it.base) ? `, ${it.base}` : ""} (${String(it.rarity ?? "").toLowerCase()}, id ${it.id})${flask}`);
      if (detail && it.mods?.length) lines.push(`    ${it.mods.join("; ")}`);
    }
    if ((s.itemSets ?? []).length > 1) lines.push(`Item sets: ${s.itemSets.map((x: any) => `${x.id}${x.id === s.activeItemSet ? "*" : ""} ${x.title ?? ""}`.trim()).join(", ")} (* active)`);
  }
  if (parts.has("tree")) {
    const t = s.tree ?? {};
    lines.push("", `TREE (${t.version}): ${t.pointsUsed} points used, ${t.pointsAtLevel} available at this level; ascendancy ${t.ascendancyPointsUsed}/8`);
    if (t.keystones?.length) lines.push(`Keystones: ${t.keystones.join(", ")}`);
    if (t.notables?.length) lines.push(`Notables (${t.notables.length}): ${t.notables.join(", ")}`);
    if (detail && t.masteries?.length) lines.push(`Masteries: ${t.masteries.join(" | ")}`);
    else if (t.masteries?.length) lines.push(`Masteries: ${t.masteries.length} (detail: true lists them)`);
    if ((s.specs ?? []).length > 1) lines.push(`Tree specs: ${s.specs.map((x: any) => `${x.index}${x.index === s.activeSpec ? "*" : ""} ${x.title ?? ""}`.trim()).join(", ")} (* active)`);
  }
  if (parts.has("config")) {
    const entries = Object.entries(s.config ?? {});
    lines.push("", `CONFIG (${entries.length} options set): ${entries.map(([k, v]) => `${k}=${v}`).join(", ") || "defaults"}`);
  }
  if (parts.has("notes") && s.notes) lines.push("", `NOTES (start; parts: ["notes"] gives all): ${s.notes}`);
  lines.push("", ASSUME(s.assumptions));
  return lines.join("\n");
}

const ICON: Record<string, string> = { error: "PROBLEM", warning: "WARNING", info: "NOTE" };

export function diagnosisText(d: any): string {
  const L: string[] = [];
  L.push(`${d.name ?? "Build"}, level ${d.level}, main skill ${d.mainSkill ?? "none"}`);
  const issues: Array<{ severity: string; category: string; message: string }> = d.issues ?? [];
  const rank: Record<string, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  L.push("", issues.length ? `FINDINGS (${issues.length})` : "FINDINGS: none, the basics are covered");
  for (const i of issues) L.push(`- ${ICON[i.severity] ?? i.severity} [${i.category}] ${i.message}`);

  const r = d.resist ?? {};
  L.push("", "1. RESISTANCES (value / cap, over cap)");
  L.push(["Fire", "Cold", "Lightning", "Chaos"].map((k) => `${k} ${r[k]?.value}%/${r[k]?.max}%${r[k]?.overCap > 0 ? ` (+${r[k].overCap})` : ""}`).join(" | "));

  L.push("", "2. SURVIVABILITY");
  const mh = d.maxHit ?? {};
  L.push(`Max hit taken: ${Object.keys(mh).map((k) => `${k} ${n(mh[k])}`).join(" | ")}  (weakest: ${d.weakestHit ?? "?"})`);
  const p = d.pool ?? {};
  L.push(`EHP ${n(p.ehp)} | Life ${n(p.life)}${p.lifeUnreserved !== p.life ? ` (${n(p.lifeUnreserved)} unreserved)` : ""} | ES ${n(p.energyShield)}${p.ward ? ` | Ward ${n(p.ward)}` : ""} | Mana ${n(p.mana)}`);
  const f = d.defence ?? {};
  L.push(`Armour ${n(f.armour)} (${n(f.physReduction)}% phys reduction) | Evasion ${n(f.evasion)} (${n(f.evadeChance)}% evade) | Suppression ${n(f.suppression)}% | Block ${n(f.block)}% / spell ${n(f.spellBlock)}%`);
  const avoid = Object.entries(d.avoid ?? {}).map(([k, v]) => `${k} ${v}%`);
  L.push(`Ailment avoidance: ${avoid.length ? avoid.join(", ") : "none"}`);

  L.push("", "3. RECOVERY AND MANA");
  const rec = d.recovery ?? {};
  const recParts = [
    ["life regen", rec.lifeRegen], ["net life regen", rec.netLifeRegen], ["life leech", rec.lifeLeech], ["life on hit", rec.lifeOnHit],
    ["ES regen", rec.esRegen], ["ES recharge", rec.esRecharge], ["ES leech", rec.esLeech], ["mana regen", rec.manaRegen], ["mana leech", rec.manaLeech],
  ].filter(([, v]) => typeof v === "number" && Math.abs(v as number) >= 0.5).map(([k, v]) => `${k} ${n(v, 0)}/s`);
  L.push(`Recovery: ${recParts.length ? recParts.join(" | ") : "none"}`);
  const m = d.mana ?? {};
  L.push(`Mana: ${n(m.unreserved)} unreserved, skill costs ${n(m.cost)}${m.costPerSecond ? ` (${n(m.costPerSecond, 0)}/s)` : ""}${m.lifeCost ? `, life cost ${n(m.lifeCost)}` : ""}`);
  const resv: Array<{ name: string; group?: number; mana: number }> = m.reservations ?? [];
  if (resv.length) L.push(`Mana reserved by: ${resv.map((r) => `${r.name} ${n(r.mana)}`).join(", ")}`);
  const a = d.attributes ?? {};
  L.push(`Attributes (have/need): ${["Str", "Dex", "Int"].map((k) => `${k} ${n(a[k]?.value)}/${n(a[k]?.required)}`).join(" | ")}`);

  L.push("", "4. DAMAGE");
  const dm = d.damage ?? {};
  const dps = [
    ["Full DPS", dm.fullDps], ["Combined DPS", dm.combinedDps], ["Hit DPS", dm.totalDps], ["DoT DPS", dm.dotDps], ["Minion DPS", dm.minionDps],
    ["Ignite", dm.igniteDps], ["Bleed", dm.bleedDps], ["Poison", dm.poisonDps], ["Impale", dm.impaleDps],
  ].filter(([, v]) => typeof v === "number" && (v as number) >= 1).map(([k, v]) => `${k} ${n(v, 0)}`);
  L.push(dps.length ? dps.join(" | ") : "No damage calculated");
  L.push(`Average hit ${n(dm.averageHit, 0)} | ${n(dm.speed, 2)}/s | hit chance ${n(dm.hitChance)}% | crit ${n(dm.critChance, 1)}% x${n(dm.critMultiplier, 2)}`);
  const types = Object.entries(dm.byType ?? {}) as Array<[string, number]>;
  const total = types.reduce((sum, [, v]) => sum + v, 0);
  if (total > 0) L.push(`Hit damage by type: ${types.sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`).join(", ")}`);
  const pt = d.points ?? {};
  L.push("", `Passive points: ${pt.used} used of ${pt.available} at this level; ascendancy ${pt.ascendancyUsed}/8`);
  L.push(ASSUME(d.assumptions));
  return L.join("\n");
}

export function bossText(res: any): string {
  const L = [`BOSS CHECK (${res.uber ? "uber" : "pinnacle"} version, PoB's boss skill presets; hits are after this character's defences)`];
  let worst = Infinity;
  for (const r of (Array.isArray(res.results) ? res.results : []) as any[]) {
    if (r.overTime || !r.taken) {
      L.push(`- ${r.skill}: damage over time, PoB gives no hit numbers for it`);
      continue;
    }
    const hits = typeof r.hitsToDie === "number" ? r.hitsToDie : undefined;
    if (hits !== undefined) worst = Math.min(worst, hits);
    const verdict = hits === undefined ? "?" : hits < 1 ? "DIES TO ONE HIT" : hits < 2 ? "survives one hit, not two" : `survives ${Math.floor(hits)} hits`;
    const types = Object.entries(r.takenByType ?? {}).map(([k, v]) => `${k} ${n(v)}`).join(", ");
    L.push(`- ${r.skill}: takes ${n(r.taken)}${types ? ` (${types})` : ""} of ${n(r.enemyDamage)} raw; pool lasts ${hits === undefined ? "?" : n(hits, 1)} hits -> ${verdict}`);
    if (r.note) L.push(`    ${r.note}`);
  }
  if (worst !== Infinity) L.push(worst < 1 ? "Verdict: not ready. At least one skill kills in one hit unless it is dodged every time." : worst < 2 ? "Verdict: risky. Every skill is survivable once, with no margin for a second hit before recovering." : "Verdict: survivable. No listed skill kills in fewer than two hits.");
  L.push(`Damage at this boss setting: ${n(res.dps)} DPS with ${res.mainSkill ?? "the main skill"}. PoB has no boss life data, so there is no kill time here.`);
  L.push(`Config assumptions: ${res.assumptions}`);
  if (res.rollbackProblem) L.push(`WARNING: the config may not be exactly as before (${res.rollbackProblem}).`);
  return L.join("\n");
}

export const readTools: Tool[] = [
  tool("build_summary", 'The open build: class, skill groups and gems, items per slot (ids), tree, config. parts ["notes"]: full notes; detail: item mods, masteries.',
    { parts: S.list(S.enum(["skills", "items", "tree", "config", "notes"]), ), detail: S.bool() }, [],
    async ({ pob }, args) => {
      const link = await pob.link();
      const { summary } = await link.call("summary");
      const parts = new Set<string>(Array.isArray(args.parts) && args.parts.length ? args.parts : ["skills", "items", "tree", "config", "notes"]);
      // Guides keep their instructions in the notes: asked for on their own, they come back in full.
      if (parts.size === 1 && parts.has("notes")) {
        const notes = String((await link.call("notes")).notes ?? "");
        return notes.trim() ? `NOTES of ${summary.name ?? "the build"} (${notes.length} characters)\n${notes.slice(0, 12000)}${notes.length > 12000 ? "\n... (cut)" : ""}` : "This build has no notes.";
      }
      return summaryText(summary, parts, args.detail === true);
    }),

  tool("stats", "PoB's numbers for the open build: key stats; match: every stat containing the text (\"Leech\", \"MaximumHitTaken\"); fields: exact names.",
    { match: S.str(), fields: S.list(S.str()) }, [],
    async ({ pob }, args) => {
      const link = await pob.link();
      if (!args.match && !(Array.isArray(args.fields) && args.fields.length)) {
        const res = await link.call("key_stats");
        return [`${res.name}: level ${res.level} ${res.className} (${res.ascendancy}), main skill ${res.mainSkill ?? "none"}`, ...statLines(res.stats), ASSUME(res.assumptions)].join("\n");
      }
      const res = await link.call("stats", { match: args.match, fields: args.fields });
      const stats = (Array.isArray(res.stats) ? {} : res.stats) as Record<string, number>;
      const keys = Object.keys(stats).sort();
      if (!keys.length) throw new ToolError(`No PoB stat matches ${args.match ? `"${args.match}"` : "those fields"}. Try a shorter word (e.g. "Resist", "DPS", "Regen").`);
      return [`Main skill: ${res.mainSkill ?? "none"}`, ...keys.map((k) => `${k}: ${typeof stats[k] === "number" ? n(stats[k], 2) : stats[k]}`), ASSUME(res.assumptions)].join("\n");
    }),

  tool("diagnose", "Health check in priority order: resists, max hit, EHP, recovery, mana, damage, plus findings (empty slots, unspent points, requirements). boss: each boss skill's hit and hits survived.",
    { boss: S.str("shaper, maven, sirus, exarch, eater, atziri, cortex, all; \"uber \" prefix") }, [],
    async ({ pob }, args) => {
      const link = await pob.link();
      const { diagnosis } = await link.call("diagnose");
      const text = diagnosisText(diagnosis);
      if (!args.boss) return text;
      return `${text}\n\n${bossText(await link.call("boss_check", { boss: String(args.boss) }))}`;
    }),

  tool("tree_search", "Find passive nodes by name or stat: id, stats, path cost, mastery effect ids.",
    { query: S.str(), type: S.enum(["keystone", "notable", "mastery", "jewel", "ascendancy", "normal"]), limit: S.num() }, ["query"],
    async ({ pob }, args) => {
      const link = await pob.link();
      const res = await link.call("tree_search", { query: args.query, type: args.type, limit: args.limit });
      const nodes = (Array.isArray(res.nodes) ? res.nodes : []) as any[];
      if (!nodes.length) return `No passive node matches "${args.query}".`;
      const lines = nodes.map((node) => {
        const where = node.allocated ? "allocated" : node.points ? `${node.points} point${node.points === 1 ? "" : "s"} away` : "not reachable";
        const head = `${node.id} ${node.name} [${node.type}${node.ascendancy ? `, ${node.ascendancy}` : ""}; ${where}]`;
        if (node.effects) return `${head}\n${node.effects.map((e: any) => `    effect ${e.id}${e.selected ? " (selected)" : ""}: ${(e.stats ?? []).join(" / ")}`).join("\n")}`;
        return `${head}: ${(node.stats ?? []).filter((x: string) => x.trim()).join("; ")}`;
      });
      if (res.total > nodes.length) lines.push(`(${res.total - nodes.length} more; narrow the query or raise limit)`);
      return lines.join("\n");
    }),
];
