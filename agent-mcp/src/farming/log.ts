/**
 * The player's own farming sessions (Stage 8): the only honest source of profit per
 * hour, since drop rates are not published. Stored in AgentCache/farming/log.json
 * (player data, not a build: allowed in a read-only chat).
 */
import fs from "fs";
import path from "path";
import { cacheDir } from "../paths.js";

export interface LogEntry { strategy: string; maps: number; minutes: number; chaos: number; spent: number; at: string; league?: string }

const file = () => path.join(cacheDir("farming"), "log.json");

export function readLog(): LogEntry[] {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8"));
    return Array.isArray(j?.entries) ? j.entries : [];
  } catch { return []; }
}

export function addLog(e: LogEntry): LogEntry[] {
  const entries = [...readLog(), e].slice(-200);
  fs.writeFileSync(file(), JSON.stringify({ entries }, null, 1));
  return entries;
}

/** Net chaos per hour measured by the player for one strategy (all its sessions, this league). */
export function measuredRate(strategy: string, league?: string): { perHour: number; maps: number; minutes: number; sessions: number; last: string } | undefined {
  const rows = readLog().filter((e) => e.strategy === strategy && (!league || !e.league || e.league === league));
  const minutes = rows.reduce((s, e) => s + e.minutes, 0);
  if (!rows.length || minutes <= 0) return undefined;
  const net = rows.reduce((s, e) => s + e.chaos - e.spent, 0);
  return { perHour: (net / minutes) * 60, maps: rows.reduce((s, e) => s + e.maps, 0), minutes, sessions: rows.length, last: rows[rows.length - 1].at };
}
