/**
 * PoE knowledge engine (roadmap Stage 9): shared types and the source hierarchy.
 *
 * Rule 1 of the engine: no source, no claim. Every fact carries where it came
 * from (`source`, `url`), which game and game version it describes and when it
 * was retrieved, so an AI can cite it and a player can check it.
 */

export type SourceId = "game" | "ggg" | "pob" | "poedb" | "poewiki" | "poe2wiki";
export type Game = "poe1" | "poe2";

export interface SourceInfo {
  /** 1 = most authoritative. When sources disagree, the lower number wins. */
  rank: number;
  label: string;
  game: Game;
}

/** Game data > official GGG > PoB data > poedb > poewiki. poe2wiki is only used for labelled PoE2 comparisons. */
export const SOURCES: Record<SourceId, SourceInfo> = {
  game: { rank: 1, label: "installed game / GGG data export", game: "poe1" },
  ggg: { rank: 2, label: "official GGG, pathofexile.com", game: "poe1" },
  pob: { rank: 3, label: "Path of Building data", game: "poe1" },
  poedb: { rank: 4, label: "poedb.tw, datamined, unofficial", game: "poe1" },
  poewiki: { rank: 5, label: "poewiki.net, community wiki", game: "poe1" },
  poe2wiki: { rank: 5, label: "poe2wiki.net, community wiki", game: "poe2" },
};

export interface Fact {
  source: SourceId;
  /** Page, item, gem, patch or glossary term the fact is about. */
  title: string;
  /** Exact wording from the source (or, for glossary entries, our summary of the quoted source). */
  text: string;
  url: string;
  game: Game;
  /** Game version the fact describes, e.g. "3.30.0". "unknown" is allowed and is flagged. */
  game_version: string;
  /** ISO date-time the source was read. */
  retrieved_at: string;
  /** ISO date-time the source itself was last changed, when the source says so. */
  edited_at?: string;
  kind?: "glossary" | "item" | "gem" | "passive" | "page" | "patch" | "history" | "version";
  /** Warnings: outdated, conflicts with a higher source, stale cache, ... */
  flags?: string[];
  /** Short exact quote backing a glossary summary. */
  quote?: string;
}

export interface GameVersion {
  version: string;
  /** ISO date (yyyy-mm-dd) the version was released, when known. */
  released?: string;
}

/** Errors whose message is safe and useful to show to the AI as-is. */
export class KbError extends Error {}

/** "3.30.0b" -> [3, 30, 0, 2]; unknown parts sort lowest. */
export function versionKey(version: string): number[] {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?([a-z])?/i.exec(version.trim());
  if (!m) return [0, 0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0), m[4] ? m[4].toLowerCase().charCodeAt(0) - 96 : 0];
}

export function compareVersions(a: string, b: string): number {
  const ka = versionKey(a), kb = versionKey(b);
  for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

/** "3.30.0b" -> "3.30": the league / content patch a version belongs to. */
export function majorOf(version: string): string {
  const k = versionKey(version);
  return `${k[0]}.${k[1]}`;
}

/** Every fact must be citable: the check the tools and the evaluation run on all output. */
export function citationProblems(fact: Fact): string[] {
  const problems: string[] = [];
  if (!SOURCES[fact.source]) problems.push("unknown source");
  if (!/^https?:\/\//.test(fact.url ?? "")) problems.push("no url");
  if (!fact.game_version) problems.push("no game_version");
  if (!fact.retrieved_at || Number.isNaN(Date.parse(fact.retrieved_at))) problems.push("no retrieved_at");
  if (!fact.text?.trim()) problems.push("no text");
  return problems;
}
