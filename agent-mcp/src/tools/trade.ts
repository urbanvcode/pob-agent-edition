// Query building and price statistics are based on ianderse/pob-mcp (https://github.com/ianderse/pob-mcp, GPL-3.0): src/services/tradeQueryBuilder.ts and src/handlers/tradeHandlers.ts.
// Licensed under the GNU General Public License v3.0; see LICENSE at the repository root.
/**
 * Trade tools: leagues, trade_search, plan_upgrades, price_check.
 *
 * Account safety rules, enforced here and in trade/client.ts:
 * - instant-buyout listings only (status "securable"); the player buys by opening the link;
 * - never whispers, never touches the game client;
 * - 1 request per 2 s, inside every limit pathofexile.com publishes, 16 requests per question.
 */
import { n } from "../format.js";
import { ToolError } from "../pob.js";
import { getProfile } from "../profile.js";
import { S, tool, type Tool } from "../registry.js";
import type { TradeApiClient } from "../trade/client.js";
import { priceInChaos, tradeItemToPoBText } from "../trade/itemText.js";
import type { ItemListing, StatFilter, TradeQuery, TradeStatsData } from "../trade/types.js";
import { currencyRates } from "../trade/ninja.js";
import { evaluateCandidate, formatPlan, INSTANT_BUYOUT, planResistFix, planUpgrades, ratesOrChaosOnly, tradeUrl, type TestStats } from "../trade/upgrades.js";

const CATEGORY: Record<string, string> = {
  "boots": "armour.boots", "gloves": "armour.gloves", "helmet": "armour.helmet", "body armour": "armour.chest", "chest": "armour.chest",
  "shield": "armour.shield", "quiver": "armour.quiver", "ring": "accessory.ring", "amulet": "accessory.amulet", "belt": "accessory.belt",
  "jewel": "jewel", "abyss jewel": "jewel.abyss", "cluster jewel": "jewel.cluster", "flask": "flask", "bow": "weapon.bow", "claw": "weapon.claw",
  "dagger": "weapon.dagger", "wand": "weapon.wand", "one hand sword": "weapon.onesword", "two hand sword": "weapon.twosword",
  "one hand axe": "weapon.oneaxe", "two hand axe": "weapon.twoaxe", "one hand mace": "weapon.onemace", "two hand mace": "weapon.twomace",
  "sceptre": "weapon.sceptre", "staff": "weapon.staff", "warstaff": "weapon.warstaff",
};

async function pcLeagues(trade: TradeApiClient): Promise<string[]> {
  const data = await trade.getLeagues();
  return [...new Set((data.result ?? []).filter((l) => !l.realm || l.realm === "pc").map((l) => l.id))];
}

/** The current challenge league: the first PC league that is not a permanent or special one. */
export function challengeLeague(ids: string[], hardcore: boolean): string | undefined {
  const base = ids.find((id) => !/standard|hardcore|ruthless|ssf|solo/i.test(id));
  if (!base) return hardcore ? ids.find((id) => id === "Hardcore") : ids.find((id) => id === "Standard");
  if (!hardcore) return base;
  return ids.find((id) => id === `Hardcore ${base}`) ?? base;
}

export async function checkLeague(trade: TradeApiClient, league: string): Promise<{ league: string; note?: string }> {
  let ids: string[];
  try {
    ids = await pcLeagues(trade);
  } catch {
    return { league, note: "League not validated (could not reach pathofexile.com)." };
  }
  const exact = ids.find((id) => id === league) ?? ids.find((id) => id.toLowerCase() === league.toLowerCase());
  if (exact) return { league: exact };
  throw new ToolError(`Unknown league "${league}". Leagues on pathofexile.com: ${ids.join(", ")}`);
}

/** League for a trade call: the argument, else the profile, else the current challenge league. */
export async function resolveLeague(trade: TradeApiClient, given: unknown): Promise<{ league: string; note?: string }> {
  if (typeof given === "string" && given.trim()) return checkLeague(trade, given.trim());
  const profile = getProfile().profile;
  if (profile.league) return { league: profile.league };
  const league = challengeLeague(await pcLeagues(trade), profile.hardcore);
  if (!league) throw new ToolError("Could not work out the current league. Call prices { leagues: true } and pass league.");
  return { league, note: `League not set in the profile; using the current challenge league "${league}".` };
}

function ssfNote(): string {
  return getProfile().profile.playMode === "ssf"
    ? "NOTE: the player profile is SSF (no trading). These listings only show what such items are worth; present them as craft/farm targets, not purchases.\n\n"
    : "";
}

// --- stat filters by text ----------------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/[+-]?\d+(\.\d+)?/g, "#").replace(/[^a-z#% ]+/g, " ").replace(/\s+/g, " ").trim();
const TYPE_RANK = ["pseudo", "explicit", "implicit", "fractured", "crafted", "enchant", "scourge"];

export function findStat(data: TradeStatsData, text: string): { id: string; text: string } | { suggestions: string[] } {
  const raw = text.trim();
  if (/^[a-z]+\.[\w.|]+$/i.test(raw)) return { id: raw, text: raw };
  const typed = /^(pseudo|explicit|implicit|fractured|crafted|enchant|scourge)\s*:\s*(.+)$/i.exec(raw);
  const wantType = typed?.[1].toLowerCase();
  const want = norm(typed ? typed[2] : raw).replace(/#/g, "").replace(/\s+/g, " ").trim();
  const all = data.result.flatMap((g) => g.entries);
  const scored = all
    .filter((e) => !wantType || e.type === wantType)
    .map((e) => ({ e, t: norm(e.text).replace(/#/g, "").replace(/\s+/g, " ").trim() }))
    .filter((x) => x.t.includes(want))
    .sort((a, b) => Number(b.t === want) - Number(a.t === want)
      || (TYPE_RANK.indexOf(a.e.type) + 99) % 99 - (TYPE_RANK.indexOf(b.e.type) + 99) % 99
      || a.t.length - b.t.length);
  if (scored.length) return { id: scored[0].e.id, text: `${scored[0].e.type}: ${scored[0].e.text}` };
  const words = want.split(" ").filter((w) => w.length > 2);
  const near = all.map((e) => ({ e, hits: words.filter((w) => e.text.toLowerCase().includes(w)).length }))
    .filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits || a.e.text.length - b.e.text.length).slice(0, 6).map((x) => `${x.e.type}: ${x.e.text}`);
  return { suggestions: near };
}

function listingLine(i: number, l: ItemListing, chaos: number | undefined): string {
  const price = l.listing.price;
  const priceText = price ? `${price.amount} ${price.currency}${price.currency !== "chaos" && chaos !== undefined ? ` (~${n(chaos)}c)` : ""}` : "no price";
  const name = [l.item.name, l.item.typeLine].filter(Boolean).join(", ");
  return `${i}. ${name} - ${priceText}${l.item.ilvl ? ` | ilvl ${l.item.ilvl}` : ""}${l.item.corrupted ? " | corrupted" : ""}`;
}

const modText = (s: unknown) => (typeof s === "string" ? s : s && typeof s === "object" && typeof (s as { description?: unknown }).description === "string" ? (s as { description: string }).description : String(s ?? ""));
const clean = (s: unknown) => modText(s).replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2").replace(/\[([^\]]+)\]/g, "$1");

export function tradeTools(): Tool[] {
  return [
    tool("leagues", "Trade leagues on pathofexile.com, with the profile league and the current challenge league marked.", {}, [],
      async ({ trade }) => {
        const ids = await pcLeagues(trade);
        const profile = getProfile().profile;
        const current = challengeLeague(ids, profile.hardcore);
        return ids.map((id) => `- ${id}${id === current && !/^(Standard|Hardcore)$/.test(id) ? " (current challenge league)" : ""}${id === profile.league ? " (profile league)" : ""}`).join("\n");
      }, { trade: true }),

    tool("trade_search", "Instant-buyout trade listings, cheapest first. stats: text filters matched to trade stats. slot: simulate each result there (DPS/EHP). League: profile default.",
      {
        name: S.str(), type: S.str("base or category: ring, bow"),
        rarity: S.enum(["unique", "rare", "magic", "normal"]),
        stats: S.list({ type: "object", properties: { text: S.str(), min: S.num(), max: S.num() }, required: ["text"] }),
        max_price: S.num(), currency: S.str(), min_links: S.num(),
        slot: S.str(), league: S.str(), limit: S.num("max 10"),
      }, [],
      async ({ trade, pob }, args) => {
        if (!args.name && !args.type && !(Array.isArray(args.stats) && args.stats.length)) throw new ToolError("Give at least one of name, type or stats.");
        const { league, note } = await resolveLeague(trade, args.league);
        const query: TradeQuery = { query: { status: { option: INSTANT_BUYOUT }, filters: {} }, sort: { price: "asc" } };
        const filters = query.query.filters!;
        const typeFilters: Record<string, unknown> = {};
        if (args.name) query.query.name = String(args.name);
        if (args.type) {
          const category = CATEGORY[String(args.type).toLowerCase()];
          if (category) typeFilters.category = { option: category };
          else query.query.type = String(args.type);
        }
        if (args.rarity) typeFilters.rarity = { option: args.rarity };
        if (Object.keys(typeFilters).length) filters.type_filters = { filters: typeFilters };
        if (args.min_links) filters.socket_filters = { filters: { links: { min: Number(args.min_links) } } };
        const price: Record<string, unknown> = { option: typeof args.currency === "string" && args.currency ? args.currency : "chaos" };
        if (typeof args.max_price === "number") price.max = args.max_price;
        filters.trade_filters = { filters: { price } };
        const used: string[] = [];
        if (Array.isArray(args.stats) && args.stats.length) {
          const data = await trade.getStats();
          const statFilters: StatFilter[] = [];
          for (const s of args.stats as Array<{ text: string; min?: number; max?: number }>) {
            const found = findStat(data, String(s.text));
            if ("suggestions" in found) {
              throw new ToolError(`No trade stat matches "${s.text}".${found.suggestions.length ? ` Closest: ${found.suggestions.join(" | ")}` : ""} Use the wording from the item (numbers as #).`);
            }
            const value: { min?: number; max?: number } = {};
            if (typeof s.min === "number") value.min = s.min;
            if (typeof s.max === "number") value.max = s.max;
            statFilters.push({ id: found.id, ...(Object.keys(value).length ? { value } : {}) });
            used.push(`${found.text}${value.min !== undefined ? ` >= ${value.min}` : ""}${value.max !== undefined ? ` <= ${value.max}` : ""}`);
          }
          query.query.stats = [{ type: "and", filters: statFilters }];
        }
        const search = await trade.searchItems(league, query);
        const head = [`${ssfNote()}Trade search in ${league} (instant buyout only): ${search.total} listing(s)`];
        if (note) head.push(note);
        if (used.length) head.push(`Stat filters: ${used.join("; ")}`);
        if (!search.result?.length) return [...head, "Nothing found. Loosen the filters or raise max_price."].join("\n");
        const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
        const listings = await trade.fetchItems(search.result.slice(0, limit), search.id);
        const notes: string[] = [];
        const rates = await ratesOrChaosOnly(league, notes);
        let sim: { base: TestStats; results: Array<{ ok: boolean; stats?: TestStats; error?: string }> } | undefined;
        if (args.slot) {
          try {
            const link = await pob.link();
            sim = (await link.call("test_items", { slot: String(args.slot), items: listings.map((l) => tradeItemToPoBText(l.item)) })).result;
          } catch (e) {
            notes.push(`Could not simulate in ${args.slot}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        const lines = [...head, ""];
        listings.forEach((l, i) => {
          lines.push(listingLine(i + 1, l, priceInChaos(l.listing.price, rates)));
          const mods = [...(l.item.implicitMods ?? []), ...(l.item.fracturedMods ?? []), ...(l.item.explicitMods ?? []), ...(l.item.craftedMods ?? [])].map(clean);
          if (mods.length) lines.push(`   ${mods.join("; ")}`);
          const r = sim?.results[i];
          if (r?.ok && r.stats && sim) {
            const ev = evaluateCandidate(sim.base, r.stats, "balanced");
            lines.push(`   In ${args.slot}: DPS ${ev.dpsPct >= 0 ? "+" : ""}${ev.dpsPct.toFixed(1)}% | EHP ${ev.ehpPct >= 0 ? "+" : ""}${ev.ehpPct.toFixed(1)}%${Math.abs(ev.lifeDelta) >= 1 ? ` | Life ${ev.lifeDelta > 0 ? "+" : ""}${Math.round(ev.lifeDelta)}` : ""}${ev.resNotes.length ? ` | ${ev.resNotes.join(", ")}` : ""}${ev.warnings.length ? ` | Warning: ${ev.warnings.join("; ")}` : ""}`);
          } else if (r && !r.ok) lines.push(`   In ${args.slot}: ${r.error}`);
          lines.push(`   ${tradeUrl(league, search.id, l.id)}`);
        });
        if (notes.length) lines.push("", ...notes.map((x) => `- ${x}`));
        lines.push("", `All results: ${tradeUrl(league, search.id)}`, "The player buys by opening a link and using the instant buyout.");
        return lines.join("\n");
      }, { trade: true }),

    tool("plan_upgrades", 'Cheap gear upgrades: instant-buyout listings per slot, simulated, ranked by gain per chaos. focus "resists": caps short resistances. Fills the Overview Advisor card.',
      {
        budget_chaos: S.num("per item, default 50"), focus: S.enum(["balanced", "dps", "defence", "resists"]),
        slots: S.list(S.str()), league: S.str(), max_results: S.num(),
      }, [],
      async ({ trade, pob }, args) => {
        const link = await pob.link();
        const { league, note } = await resolveLeague(trade, args.league);
        const budget = Math.max(1, Number(args.budget_chaos) || 50);
        const focus = (["balanced", "dps", "defence"].includes(args.focus) ? args.focus : "balanced") as "balanced" | "dps" | "defence";
        const planArgs = { league, budget_chaos: budget, focus, slots: Array.isArray(args.slots) ? args.slots.map(String) : undefined, max_results: Number(args.max_results) || undefined };
        let result: { candidates: Awaited<ReturnType<typeof planUpgrades>>["candidates"]; notes: string[] };
        let resistHead = "";
        if (args.focus === "resists") {
          const fix = await planResistFix(link, trade, planArgs);
          const short = (Object.keys(fix.missing) as Array<keyof typeof fix.missing>).filter((k) => fix.missing[k] > 0).map((k) => `${k} ${fix.missing[k]}%`);
          if (!short.length) return "All resistances are capped (fire, cold, lightning and chaos): nothing to fix, no trade search was made.";
          resistHead = `Missing resistance now: ${short.join(", ")}. Ranked by how much of it each item really fixes once it replaces what is in the slot.\n`;
          result = fix;
        } else {
          result = await planUpgrades(link, trade, planArgs);
        }
        let shown = "";
        if (link.kind === "live") {
          try {
            await link.call("set_advisor", {
              league, budget, focus, time: Date.now(),
              items: result.candidates.map((c) => ({
                slot: c.slot, name: c.name, rarity: c.rarity, priceText: c.priceText, priceChaos: c.priceChaos,
                dpsPct: c.dpsPct, ehpPct: c.ehpPct, lifeDelta: c.lifeDelta, resNotes: c.resNotes, warnings: c.warnings,
                url: c.url, itemText: c.itemText, seller: c.seller,
              })),
              notes: result.notes,
            });
            shown = "\nAlso shown in PoB Agent Edition > Overview > Advisor (hover to compare, click to open the listing).";
          } catch { /* the text result is complete without the card */ }
        }
        const stats = await link.call("key_stats").catch(() => null);
        return `${ssfNote()}${resistHead}${formatPlan(league, budget, result)}${note ? `\n${note}` : ""}\n\nNumbers are PoB simulations of swapping each item into the current build.${stats ? ` Config assumptions: ${stats.assumptions}.` : ""} The player buys by opening a link and using the instant buyout.${shown}`;
      }, { trade: true }),

    tool("currency", "Currency exchange rates in chaos (poe.ninja) for the league, and what the profile's currency on hand is worth.",
      { league: S.str(), search: S.str("Only currencies whose name contains this") }, [],
      async ({ trade }, args) => {
        const { league, note } = await resolveLeague(trade, args.league);
        let rates: Map<string, number>;
        try {
          rates = await currencyRates(league);
        } catch (e) {
          throw new ToolError(`Could not load currency rates for ${league} from poe.ninja (${e instanceof Error ? e.message : String(e)}). Try again later; prices { name: "Divine Orb" } also works.`);
        }
        const main = ["Divine Orb", "Exalted Orb", "Mirror of Kalandra", "Orb of Annulment", "Vaal Orb", "Orb of Alchemy", "Orb of Fusing", "Chromatic Orb", "Jeweller's Orb", "Orb of Regret", "Orb of Scouring", "Regal Orb", "Gemcutter's Prism", "Orb of Alteration"];
        const search = typeof args.search === "string" ? args.search.toLowerCase() : "";
        const names = search ? [...rates.keys()].filter((k) => k.toLowerCase().includes(search)).sort((a, b) => (rates.get(b) ?? 0) - (rates.get(a) ?? 0)).slice(0, 25) : main.filter((k) => rates.has(k));
        if (!names.length) return `No currency matching "${args.search}" in ${league}.`;
        const value = (c: number) => (c >= 10 ? n(c) : c >= 1 ? n(c, 1) : `1/${n(1 / c, 1)}`);
        const lines = [`Currency rates in ${league} (poe.ninja, 1 unit in chaos; 1/x means x for one chaos)`, ...names.map((k) => `- ${k}: ${value(rates.get(k)!)}c`)];
        if (note) lines.push(note);
        const p = getProfile().profile;
        const divine = rates.get("Divine Orb");
        if (p.currency.chaos || p.currency.divine) {
          const worth = p.currency.chaos + (divine ? p.currency.divine * divine : 0);
          lines.push(`Profile currency on hand: ${p.currency.chaos}c + ${p.currency.divine} div = about ${n(worth)}c${divine ? ` (${n(worth / divine, 1)} div)` : ""}${p.currency.other ? `, plus: ${p.currency.other}` : ""}`);
        }
        return lines.join("\n");
      }, { trade: true }),

    tool("price_check", "What an item costs now: the cheapest instant-buyout listings for a name (uniques, gems, bases). League defaults to the profile.",
      { name: S.str(), type: S.str("Base type, to narrow"), league: S.str() }, ["name"],
      async ({ trade }, args) => {
        const { league, note } = await resolveLeague(trade, args.league);
        const build = (useName: boolean): TradeQuery => ({
          query: {
            status: { option: INSTANT_BUYOUT }, ...(useName ? { name: String(args.name) } : { term: String(args.name) }),
            ...(args.type ? { type: String(args.type) } : {}), filters: { trade_filters: { filters: { sale_type: { option: "priced" } } } },
          },
          sort: { price: "asc" },
        });
        let search;
        try {
          search = await trade.searchItems(league, build(true));
        } catch (e) {
          // "Unknown item name": fall back to a free-text search (bases, gems).
          if (!/400|unknown|invalid/i.test(e instanceof Error ? e.message : "")) throw e;
          search = await trade.searchItems(league, build(false));
        }
        if (!search.result?.length) return `No instant-buyout listings for "${args.name}" in ${league}.${note ? ` ${note}` : ""}`;
        const listings = await trade.fetchItems(search.result.slice(0, 10), search.id);
        const notes: string[] = [];
        const rates = await ratesOrChaosOnly(league, notes);
        const priced = listings.map((l) => ({ l, chaos: priceInChaos(l.listing.price, rates) })).filter((x) => x.chaos !== undefined) as Array<{ l: ItemListing; chaos: number }>;
        const lines = [`Price check: ${args.name} in ${league} (instant buyout, ${search.total} listing(s))`];
        if (note) lines.push(note);
        if (priced.length) {
          const sorted = priced.map((x) => x.chaos).sort((a, b) => a - b);
          const divine = rates.get("Divine Orb");
          const median = sorted[Math.floor(sorted.length / 2)];
          lines.push(`Cheapest ${n(sorted[0])}c | median of the ${sorted.length} cheapest ${n(median)}c${divine ? ` (${n(median / divine, 2)} div; 1 div = ${n(divine)}c)` : ""}`);
          if (sorted.length >= 3 && sorted[0] < median * 0.5) lines.push("The cheapest listing is far below the rest: likely a price-fixing or bait listing, trust the median.");
        }
        lines.push("", ...listings.slice(0, 5).map((l, i) => listingLine(i + 1, l, priceInChaos(l.listing.price, rates))), ...notes.map((x) => `- ${x}`), "", tradeUrl(league, search.id));
        return lines.join("\n");
      }, { trade: true }),
  ];
}
