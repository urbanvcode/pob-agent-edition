// The atlas tools are ported from our pob-mcp fork (ianderse/pob-mcp (https://github.com/ianderse/pob-mcp, GPL-3.0)): src/handlers/atlasHandlers.ts.
// Licensed under the GNU General Public License v3.0; see LICENSE at the repository root.
/** Atlas tools and simulated suggestions (passives, anoints, affix tiers). */
import { n, pct } from "../format.js";
import { ToolError } from "../pob.js";
import { S, tool, type Tool } from "../registry.js";
import { benchFixes, craftPlan } from "../craft/plan.js";

interface AtlasNode { id: string; name?: string; type?: string; stats?: string[]; allocated?: boolean; pathCost?: number | null }

function describeAtlas(node: AtlasNode): string {
  const kind = node.type === "notable" ? " (notable)" : node.type === "keystone" ? " (KEYSTONE)" : node.type === "wormhole" ? " (gateway)" : "";
  return `[${node.id}] ${node.name || "?"}${kind}${node.stats?.length ? ` - ${node.stats.join("; ")}` : ""}`;
}

const ids = (v: unknown): string[] | undefined => (Array.isArray(v) && v.length ? v.map(String) : undefined);
const FOCUS = S.enum(["balanced", "dps", "defence"]);

export const atlasTools: Tool[] = [
  tool("atlas_get", "The build's atlas passive tree: points used, notables and keystones, points per league mechanic, combined bonuses, share link.", {}, [],
    async ({ pob }) => {
      const r = (await (await pob.link()).call("atlas_get")).result;
      const nodes = (Array.isArray(r.nodes) ? r.nodes : []) as AtlasNode[];
      const special = nodes.filter((x) => x.type !== "normal");
      const mechanics = (Array.isArray(r.mechanics) ? r.mechanics : []) as Array<{ name: string; points: number }>;
      const bonuses = (Array.isArray(r.bonuses) ? r.bonuses : []) as string[];
      return [
        `Atlas tree ${String(r.version).replace("_", ".")}: ${r.pointsUsed} / ${r.pointsTotal} points`,
        special.length ? "Notables and keystones:" : "No notables or keystones allocated yet.",
        ...special.map((x) => "- " + describeAtlas(x)),
        `Small passives: ${nodes.length - special.length}`,
        `Points per mechanic: ${mechanics.map((m) => `${m.name} ${m.points}`).join(", ") || "none"}`,
        ...(bonuses.length ? ["Combined bonuses:", ...bonuses.map((b) => "- " + b)] : []),
        `Share link: ${r.link}`,
      ].join("\n");
    }),

  tool("atlas_search", "Find atlas passives by name or stat text: ids and the points needed to reach each.", { query: S.str(), limit: S.num() }, ["query"],
    async ({ pob }, args) => {
      const res = (await (await pob.link()).call("atlas_search", { query: String(args.query), limit: Number(args.limit) || 25 })).result;
      const nodes = (Array.isArray(res) ? res : []) as AtlasNode[];
      if (!nodes.length) return `No atlas passives match "${args.query}".`;
      return nodes.map((x) => `${describeAtlas(x)}${x.allocated ? "  [allocated]" : typeof x.pathCost === "number" ? `  [+${x.pathCost} points]` : "  [not reachable]"}`).join("\n");
    }),

  tool("atlas_edit", "Change the atlas tree: add (path included) or remove passives by id, replace the whole tree, or import a pathofexile.com atlas link. 150 points.",
    { add: S.list(S.str()), remove: S.list(S.str()), replace: S.list(S.str(), "The complete new node list"), link: S.str() }, [],
    async ({ pob }, args) => {
      const params = { add: ids(args.add), remove: ids(args.remove), replace: ids(args.replace), link: typeof args.link === "string" && args.link ? args.link : undefined };
      if (!params.add && !params.remove && !params.replace && !params.link) throw new ToolError("Give add, remove, replace (lists of atlas node ids from atlas { query }) or link.");
      const r = (await (await pob.link()).call("atlas_edit", params)).result;
      const lines = [`Atlas updated: ${r.pointsUsed} / ${r.pointsTotal} points used.`];
      const added = Array.isArray(r.added) ? r.added.length : 0, removed = Array.isArray(r.removed) ? r.removed.length : 0;
      if (added) lines.push(`Added ${added} passives (path included).`);
      if (removed) lines.push(`Removed ${removed} passives.`);
      if (Array.isArray(r.errors) && r.errors.length) lines.push("Not added:", ...r.errors.map((e: string) => `- ${e}`));
      lines.push("Not saved yet: save_build with a new name keeps it.");
      return lines.join("\n");
    }),
];

export const adviceTools: Tool[] = [
  tool("suggest_passives", "Best passives to take next: simulates nearby notables, keystones and mastery effects (with their path) in PoB and ranks by gain per point.",
    { max_points: S.num("Path length limit, default 5"), focus: FOCUS, limit: S.num() }, [],
    async ({ pob }, args) => {
      const res = await (await pob.link()).call("suggest_passives", { max_points: args.max_points, focus: args.focus, limit: args.limit }, 120_000);
      const list = (Array.isArray(res.suggestions) ? res.suggestions : []) as any[];
      const head = `Passive suggestions (${res.focus}, within ${res.maxPoints} points; ${res.pointsFree} unspent point(s) at this level; ${res.evaluated} options simulated)`;
      if (!list.length) return `${head}\nNothing nearby improves the build for this focus. Try a larger max_points or another focus.`;
      const lines = list.map((s, i) => {
        const life = Math.abs(s.lifeDelta) >= 1 ? ` | Life ${s.lifeDelta > 0 ? "+" : ""}${Math.round(s.lifeDelta)}` : "";
        const how = s.effect ? `mastery effect ${s.effect}` : String(s.type).toLowerCase();
        return `${i + 1}. ${s.name} [id ${s.id}, ${how}, ${s.points} point${s.points === 1 ? "" : "s"}]: DPS ${pct(s.dpsPct)} | EHP ${pct(s.ehpPct)}${life}\n   ${(s.stats ?? []).filter((x: string) => x.trim()).join("; ")}`;
      });
      return [head, ...lines, `Config assumptions: ${res.assumptions}`, "Apply with edit (alloc, or mastery with the effect id); preview first with what_if."].join("\n");
    }),

  tool("anoint", "Best amulet anointments: simulates every anointable notable in PoB and lists the top ones with their oil recipes.",
    { focus: FOCUS, limit: S.num(), slot: S.str("Default Amulet") }, [],
    async ({ pob }, args) => {
      const res = await (await pob.link()).call("anoint", { focus: args.focus, limit: args.limit, slot: args.slot }, 180_000);
      const list = (Array.isArray(res.candidates) ? res.candidates : []) as any[];
      const baseDps = res.base?.CombinedDPS ?? 0, baseEhp = res.base?.TotalEHP ?? 0;
      const head = `Anoint options for ${res.slot} (${res.baseType}); ${res.evaluated} notables simulated; changes are measured against the amulet without an anoint`;
      if (!list.length) return `${head}\nNo anoint candidates.`;
      const lines = list.map((c, i) => {
        const d = baseDps > 0 ? pct((c.dpsDelta / baseDps) * 100) : n(c.dpsDelta);
        const e = baseEhp > 0 ? pct((c.ehpDelta / baseEhp) * 100) : n(c.ehpDelta);
        return `${i + 1}. ${c.name}: DPS ${d} | EHP ${e} | oils: ${(c.recipe ?? []).map((o: string) => o.replace(/Oil$/, "")).join(", ")}`;
      });
      return [head, ...lines, `Config assumptions: ${res.assumptions}`].join("\n");
    }),

  tool("affixes", `PoB mod tables. query: tiers of a prefix/suffix (ranges, ilvl, item types); bench: true for bench crafts. slot or item_text: classify an item's mods (tier, bench, open prefixes/suffixes). craft: plan to craft wanted stats ("life, 2 res, crit multi") on slot's base or base: methods by expected cost with odds, steps, stop points, buy vs craft, gain simulated; "item" = item_text is the target (guide item); "fix" = bench crafts for slot, simulated.`,
    {
      query: S.str(), item: S.str("tag: ring, body_armour; bench: class Ring"),
      type: S.enum(["Prefix", "Suffix"]), bench: S.bool(), limit: S.num(),
      slot: S.str(), item_text: S.str(), craft: S.str(), base: S.str("base type"), ilvl: S.num("default 84"),
    }, [],
    async (ctx, args) => {
      const { pob } = ctx;
      if (typeof args.craft === "string" && args.craft.trim()) {
        if (args.craft.trim().toLowerCase() === "fix") {
          if (!args.slot) throw new ToolError('craft: "fix" needs slot.');
          return benchFixes(ctx, String(args.slot), "balanced");
        }
        return (await craftPlan(ctx, { craft: args.craft, slot: args.slot, item_text: args.item_text, base: args.base, ilvl: typeof args.ilvl === "number" ? args.ilvl : undefined })).text;
      }
      if (args.slot || args.item_text) {
        const link = await pob.link(!args.item_text);
        const it = (await link.call("classify_item", { slot: args.slot, text: args.item_text })).item;
        const head = `${it.name}${it.base && !String(it.name).includes(it.base) ? `, ${it.base}` : ""} (${String(it.rarity).toLowerCase()}${it.itemLevel ? `, ilvl ${it.itemLevel}` : ""})`;
        if (!it.prefixes) return [head, ...(it.notes ?? [])].join("\n");
        const open = (x: { used: number; limit: number }) => `${x.used}/${x.limit}${x.used < x.limit ? ` (${x.limit - x.used} open)` : ""}`;
        const lines = [`${head}: prefixes ${open(it.prefixes)}, suffixes ${open(it.suffixes)}`];
        for (const m of (Array.isArray(it.mods) ? it.mods : []) as any[]) {
          const what = m.source === "bench" ? "bench craft" : m.tier ? `T${m.tier} of ${m.tiers}, ilvl ${m.level}` : `ilvl ${m.level}`;
          lines.push(`${m.type} "${m.name}" (${what}${m.fractured ? ", fractured" : ""}): ${(m.lines ?? []).join(" / ")}  [rolls ${(m.range ?? []).join(" / ")}]`);
        }
        const unmatched = (Array.isArray(it.unmatched) ? it.unmatched : []) as string[];
        if (unmatched.length) lines.push(`Not classified: ${unmatched.join("; ")}`);
        for (const note of (Array.isArray(it.notes) ? it.notes : []) as string[]) lines.push(`Note: ${note}`);
        lines.push("T1 is the best tier this base can roll. Bench options for an open slot: affixes with bench: true.");
        return lines.join("\n");
      }
      if (!args.query) throw new ToolError("Give query (stat text to look up), or slot / item_text to classify an item.");
      const link = await pob.link(false);
      const res = await link.call("affixes", { query: args.query, item: args.item, type: args.type, bench: args.bench === true, limit: args.limit });
      const mods = (Array.isArray(res.mods) ? res.mods : []) as any[];
      if (!mods.length) return `No ${args.bench ? "bench craft" : "affix"} matches "${args.query}"${args.item ? ` on "${args.item}"` : ""}. Try fewer words${args.item ? " or drop item" : ""}.`;
      const lines = mods.map((m) => `${m.type} "${m.name}" (ilvl ${m.level}, ${m.group}): ${(m.stats ?? []).join(" / ")}${args.item ? "" : `  [${(m.items ?? []).slice(0, 8).join(", ")}${(m.items ?? []).length > 8 ? ", ..." : ""}]`}`);
      if (res.total > mods.length) lines.push(`(${res.total - mods.length} more; narrow with item/type or raise limit)`);
      return [`Source: ${res.source}; highest tier first within each group`, ...lines].join("\n");
    }, { trade: true }),

  tool("suggest_gems", "Support gem check for a skill: what each current support is worth (DPS lost without it), then every support gem that fits, simulated in place of the weakest one and ranked by DPS. add: true tests an extra link instead.",
    { group: S.num("Skill group; default the main skill"), replace: S.num("Gem number to replace; default the weakest support"), add: S.bool(), awakened: S.bool("Default true"), limit: S.num() }, [],
    async ({ pob }, args) => {
      const res = await (await pob.link()).call("suggest_gems", { group: args.group, replace: args.replace, add: args.add === true, awakened: args.awakened, limit: args.limit }, 180_000);
      const L = [`Support gems for ${res.skill ?? "the skill"} (group ${res.group}): ${n(res.baseDps)} DPS, mana cost ${n(res.manaCost)}`];
      for (const a of (Array.isArray(res.assumed) ? res.assumed : []) as any[]) L.push(`Measured with ${a.skill}: ${a.label} = ${a.value} (0 in PoB, ${a.note}; ${pct(a.dpsPct)} DPS). Set it in Configuration to what you hold in fights.`);
      const unset = (Array.isArray(res.unsetCounts) ? res.unsetCounts : []) as any[];
      if (unset.length) L.push(`Not set in PoB (0), numbers may be low: ${unset.map((u) => `${u.skill}: ${u.label}`).join("; ")}`);
      const current = (Array.isArray(res.current) ? res.current : []) as any[];
      L.push(current.length ? "Current supports, weakest first (DPS lost if removed):" : "No active support gems in this group.");
      for (const c of current) L.push(`- gem ${c.gem} ${c.name} ${c.level}/${c.quality}: ${pct(-c.lossPct)}${c.unmeasured ? `  <- not measured: ${c.unmeasured}` : c.lossPct < 0.5 ? "  <- does almost nothing for damage here (or PoB does not model its effect)" : ""}`);
      const list = (Array.isArray(res.candidates) ? res.candidates : []) as any[];
      const ups = (Array.isArray(res.levelUps) ? res.levelUps : []) as any[];
      if (ups.length) L.push("Under-levelled gems (levelling them is free damage):", ...ups.map((u) => `- gem ${u.gem} ${u.name}: level ${u.from} -> ${u.to} gives DPS ${pct(u.dpsPct)}`));
      const at = `at the highest gem level a level ${res.characterLevel} character can use, 20% quality`;
      L.push("", res.mode === "replace" ? `Best supports in place of ${res.targetName} (gem ${res.target}), ${at}:` : `Best supports as an extra link, ${at}:`);
      if (res.targetCaveat) L.push(`Caution: ${res.targetCaveat}.`);
      const line = (c: any, i: number) => `${i + 1}. ${c.name} (level ${c.level}): DPS ${pct(c.dpsPct)}${c.manaCost !== undefined ? ` | mana cost ${n(c.manaCost)}` : ""}${c.warning ? ` | Warning: ${c.warning}` : ""}`;
      if (!list.length) L.push("None.");
      list.forEach((c, i) => L.push(line(c, i)));
      L.push(res.better > 0 ? `${res.better} of ${res.tried} fitting supports beat the current setup.` : `None of the ${res.tried} fitting supports beats the current setup: the links are already the best PoB can find.`);
      const play = (Array.isArray(res.playstyle) ? res.playstyle : []) as any[];
      if (play.length) L.push(`Not ranked because they change how the skill is played: ${play.map((c) => `${c.name} ${pct(c.dpsPct)} (${c.playstyle})`).join(", ")}`);
      L.push(`Config assumptions: ${res.assumptions}`, "A support can win on paper and still have a drawback PoB does not price in (lost clear speed, ailments, mana). Try one with what_if: remove_gem + add_gem.");
      if (res.rollbackProblem) L.push(`WARNING: the build may not be exactly as before (${res.rollbackProblem}).`);
      return L.join("\n");
    }),

  tool("suggest_jewels", "What to look for on a jewel: simulates every jewel mod (best tier, top roll) alone in an allocated socket and ranks them. kind: jewel (Crimson/Viridian/Cobalt), abyss, watchers_eye, or cluster (cluster jewel notables).",
    { kind: S.enum(["jewel", "abyss", "watchers_eye", "cluster"]), focus: FOCUS, limit: S.num(), socket: S.str("Jewel socket node id; default an allocated one") }, [],
    async ({ pob }, args) => {
      const res = await (await pob.link()).call("suggest_jewels", { kind: args.kind, focus: args.focus, limit: args.limit, socket: args.socket }, 180_000);
      const mods = (Array.isArray(res.mods) ? res.mods : []) as any[];
      const L = [`Jewel mods for this build (${res.kind}, ${res.focus}; ${res.evaluated} simulated; ${res.baseline})`];
      if (!mods.length) L.push("No mod of this kind improves the build for this focus.");
      mods.forEach((m, i) => {
        const life = Math.abs(m.lifeDelta) >= 1 ? ` | Life ${m.lifeDelta > 0 ? "+" : ""}${Math.round(m.lifeDelta)}` : "";
        const tags = [m.affix ? String(m.affix).toLowerCase() : "", Array.isArray(m.rollsOn) ? m.rollsOn.join("/") : ""].filter(Boolean).join("; ");
        L.push(`${i + 1}. ${m.name ? `${m.name}: ` : ""}${(m.stats ?? []).filter((x: string) => x.trim()).join(" / ")}${tags ? ` [${tags}]` : ""}: DPS ${pct(m.dpsPct)} | EHP ${pct(m.ehpPct)}${life}`);
      });
      L.push(`Config assumptions: ${res.assumptions}`);
      if (res.kind !== "cluster") L.push("A real jewel has up to 4 mods (a Watcher's Eye 2-3) at lower rolls: add the gains up only roughly. Find one with trade_search (type \"jewel\", the stat texts) and test it with what_if.");
      return L.join("\n");
    }),
];
