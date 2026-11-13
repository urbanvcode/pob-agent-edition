/** pathofexile.com trade API shapes (only what the tools use). */

export interface StatFilter {
  id: string;
  value?: { min?: number; max?: number; weight?: number };
  disabled?: boolean;
}

export interface StatFilterGroup {
  type: "and" | "or" | "not" | "count" | "if" | "weight";
  filters: StatFilter[];
  value?: { min?: number; max?: number };
  disabled?: boolean;
}

export interface TradeQuery {
  query: {
    status?: { option: "available" | "online" | "onlineleague" | "securable" | "any" };
    name?: string;
    type?: string;
    term?: string;
    stats?: StatFilterGroup[];
    filters?: Record<string, { filters?: Record<string, unknown>; disabled?: boolean }>;
  };
  sort?: Record<string, "asc" | "desc">;
}

export interface SearchResult {
  id: string;
  complexity?: number;
  result: string[];
  total: number;
  inexact?: boolean;
}

export interface TradeItem {
  id: string;
  name: string;
  typeLine: string;
  baseType?: string;
  ilvl?: number;
  rarity?: string;
  frameType: number;
  properties?: Array<{ name: string; values: Array<[string, number]> }>;
  sockets?: Array<{ group: number; sColour?: string; attr?: string }>;
  implicitMods?: string[];
  explicitMods?: string[];
  craftedMods?: string[];
  enchantMods?: string[];
  fracturedMods?: string[];
  corrupted?: boolean;
}

export interface TradeListing {
  indexed?: string;
  account?: { name?: string; online?: unknown };
  price?: { type?: string; amount: number; currency: string };
}

export interface ItemListing {
  id: string;
  listing: TradeListing;
  item: TradeItem;
}

export interface FetchResult {
  result: ItemListing[];
}

export interface LeagueData {
  result: Array<{ id: string; realm?: string; text?: string }>;
}

export interface TradeStatsData {
  result: Array<{ id: string; label: string; entries: Array<{ id: string; text: string; type: string }> }>;
}
