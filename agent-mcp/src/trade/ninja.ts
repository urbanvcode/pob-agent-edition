// Ported from ianderse/pob-mcp (https://github.com/ianderse/pob-mcp, GPL-3.0), original file: src/services/poeNinjaClient.ts. (currency rates only).
// Licensed under the GNU General Public License v3.0; see LICENSE at the repository root.
/**
 * poe.ninja currency rates (chaos equivalents), used to compare listings
 * priced in different currencies. Cached for 5 minutes per league.
 */
import { USER_AGENT } from "../paths.js";

interface Rate { id: string; primaryValue: number }
interface Item { id: string; name: string }

const cache = new Map<string, { at: number; rates: Map<string, number> }>();

/** Accepts both poe.ninja response generations; returns currency name -> chaos. */
export function parseRates(data: unknown): Map<string, number> {
  const d = (data ?? {}) as { lines?: unknown[]; items?: Item[]; core?: { primary?: string } };
  const rates = new Map<string, number>([["Chaos Orb", 1]]);
  const lines = Array.isArray(d.lines) ? d.lines : [];
  const first = lines[0] as Record<string, unknown> | undefined;
  if (first && "currencyTypeName" in first) {
    for (const l of lines as Array<{ currencyTypeName?: string; chaosEquivalent?: number }>) {
      if (l.currencyTypeName && l.chaosEquivalent && l.chaosEquivalent > 0) rates.set(l.currencyTypeName, l.chaosEquivalent);
    }
    return rates;
  }
  const items = Array.isArray(d.items) ? d.items : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const chaos = items.find((i) => i.name === "Chaos Orb");
  const chaosLine = chaos ? (lines as Rate[]).find((l) => l.id === chaos.id) : undefined;
  const chaosValue = chaosLine?.primaryValue ?? (d.core?.primary === "chaos" ? 1 : undefined);
  if (!chaosValue || !(chaosValue > 0)) throw new Error("poe.ninja reply had no usable Chaos Orb rate");
  for (const l of lines as Rate[]) {
    const item = byId.get(l.id);
    const value = l.primaryValue / chaosValue;
    if (item?.name && Number.isFinite(value) && value > 0) rates.set(item.name, value);
  }
  return rates;
}

export async function currencyRates(league: string): Promise<Map<string, number>> {
  const hit = cache.get(league);
  if (hit && Date.now() - hit.at < 300_000) return hit.rates;
  const url = `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=Currency`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`poe.ninja request failed (${response.status})`);
  const rates = parseRates(await response.json());
  cache.set(league, { at: Date.now(), rates });
  return rates;
}
