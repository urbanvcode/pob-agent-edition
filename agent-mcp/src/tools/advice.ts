// The atlas tools are ported from our pob-mcp fork (ianderse/pob-mcp (https://github.com/ianderse/pob-mcp, GPL-3.0)): src/handlers/atlasHandlers.ts.
// Licensed under the GNU General Public License v3.0; see LICENSE at the repository root.
/** Atlas tools and simulated suggestions (passives, anoints, affix tiers). */
import { n, pct } from "../format.js";
import { ToolError } from "../pob.js";
import { S, tool, type Tool } from "../registry.js";

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
      if (!params.add && !params.remove && !params.replace && !params.link) throw new ToolError("Give add, remove, replace (lists of atlas node ids from atlas_search) or link.");
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
      return [head, ...lines, `Config assumptions: ${res.assumptions}`, "Apply with edit_tree (alloc, or mastery with the effect id); preview first with what_if."].join("\n");
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

  tool("affixes", "Item affix data from PoB's mod tables: tiers of a rollable prefix/suffix (stat ranges, required item level, which items roll it), or crafting-bench mods with bench: true.",
    { query: S.str("Stat text, e.g. \"maximum life\""), item: S.str("Item tag (\"ring\", \"body_armour\", \"bow\") or with bench an item class (\"Ring\")"), type: S.enum(["Prefix", "Suffix"]), bench: S.bool(), limit: S.num() }, ["query"],
    async ({ pob }, args) => {
      const link = await pob.link(false);
      const res = await link.call("affixes", { query: args.query, item: args.item, type: args.type, bench: args.bench === true, limit: args.limit });
      const mods = (Array.isArray(res.mods) ? res.mods : []) as any[];
      if (!mods.length) return `No ${args.bench ? "bench craft" : "affix"} matches "${args.query}"${args.item ? ` on "${args.item}"` : ""}. Try fewer words${args.item ? " or drop item" : ""}.`;
      const lines = mods.map((m) => `${m.type} "${m.name}" (ilvl ${m.level}, ${m.group}): ${(m.stats ?? []).join(" / ")}${args.item ? "" : `  [${(m.items ?? []).slice(0, 8).join(", ")}${(m.items ?? []).length > 8 ? ", ..." : ""}]`}`);
      if (res.total > mods.length) lines.push(`(${res.total - mods.length} more; narrow with item/type or raise limit)`);
      return [`Source: ${res.source}; highest tier first within each group`, ...lines].join("\n");
    }),
];
