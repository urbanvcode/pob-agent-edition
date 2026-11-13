/**
 * Disk limits for AgentCache (Stage 17). Runs once when the server starts, in the
 * background, and only deletes files that are safe to lose: they are fetched or
 * rebuilt again when needed. Character history has its own limits (character.ts).
 */
import fs from "fs";
import path from "path";
import { cacheDir } from "./paths.js";

const DAY = 86_400_000;

interface Limit {
  sub: string;
  /** File names to consider (others are never touched). */
  match: RegExp;
  maxFiles?: number;
  maxBytes?: number;
  maxAgeDays?: number;
}

export const LIMITS: Limit[] = [
  { sub: path.join("knowledge", "http"), match: /\.json$/, maxBytes: 50 * 1024 * 1024, maxAgeDays: 60 },
  { sub: "snapshots", match: /\.xml$/, maxFiles: 100, maxAgeDays: 90 },
  // PoB's item icon cache: pictures only (index.json stays); PoB downloads a missing icon again.
  { sub: "icons", match: /\.png$/i, maxBytes: 50 * 1024 * 1024 },
];

/** Deletes the oldest matching files until the folder is within its limits. Returns what was removed. */
export function pruneDir(dir: string, limit: Omit<Limit, "sub">, now = Date.now()): { files: number; bytes: number } {
  let entries: { file: string; size: number; mtime: number }[] = [];
  try {
    entries = fs.readdirSync(dir)
      .filter((f) => limit.match.test(f))
      .map((f) => {
        const file = path.join(dir, f);
        const st = fs.statSync(file);
        return { file, size: st.size, mtime: st.mtimeMs };
      })
      .filter((e) => Number.isFinite(e.size));
  } catch {
    return { files: 0, bytes: 0 };
  }
  entries.sort((a, b) => b.mtime - a.mtime); // newest first
  const removed = { files: 0, bytes: 0 };
  let kept = 0;
  let bytes = 0;
  for (const e of entries) {
    const tooOld = limit.maxAgeDays !== undefined && now - e.mtime > limit.maxAgeDays * DAY;
    const tooMany = limit.maxFiles !== undefined && kept >= limit.maxFiles;
    const tooBig = limit.maxBytes !== undefined && bytes + e.size > limit.maxBytes;
    if (tooOld || tooMany || tooBig) {
      try { fs.rmSync(e.file, { force: true }); removed.files++; removed.bytes += e.size; } catch { /* in use: next time */ }
    } else {
      kept++;
      bytes += e.size;
    }
  }
  return removed;
}

/** Keeps a log file under maxBytes by dropping its oldest lines. */
export function trimLog(file: string, maxBytes: number): void {
  try {
    if (fs.statSync(file).size <= maxBytes) return;
    const text = fs.readFileSync(file, "utf8");
    const tail = text.slice(-Math.floor(maxBytes / 2));
    fs.writeFileSync(file, tail.slice(tail.indexOf("\n") + 1));
  } catch { /* missing or busy */ }
}

export function pruneCaches(): void {
  if (process.env.POB_AGENT_CACHE_PRUNE === "off") return;
  for (const l of LIMITS) pruneDir(cacheDir(l.sub), l);
  trimLog(path.join(cacheDir("knowledge"), "answers.log"), 2 * 1024 * 1024);
}
