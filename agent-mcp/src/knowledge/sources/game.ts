/**
 * The installed Path of Exile 1 client, read-only: is it installed (Steam or
 * standalone), which build, and when was it last patched.
 *
 * This is the freshness signal of the top source tier: when the client was
 * patched after our version data was read, the engine re-checks the game
 * version before answering. Nothing is ever written to the game folder, the
 * client is never started or touched, and the install path is never shown.
 *
 * Reading the game's data tables themselves needs the Oodle extractor that
 * PoB's exporter (src/Export) uses; it is not shipped, so that stays with PoB's
 * exported data (see sources/pobdata.ts).
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

export interface InstalledGame {
  client: "steam" | "standalone";
  /** Steam build id, when installed through Steam. */
  build?: string;
  /** ISO date-time the client was last patched. */
  updated_at?: string;
}

const STEAM_APP = "238960"; // Path of Exile (1) on Steam

function regValue(key: string, name: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const out = execFileSync("reg", ["query", key, "/v", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000, windowsHide: true });
    return new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`).exec(out)?.[1]?.trim();
  } catch { return undefined; }
}

/** Steam's appmanifest_<id>.acf -> build id and last update. */
export function parseAppManifest(text: string): { build?: string; updated_at?: string } {
  const value = (key: string) => new RegExp(`"${key}"\\s+"([^"]*)"`).exec(text)?.[1];
  const updated = Number(value("LastUpdated"));
  return { build: value("buildid"), updated_at: updated > 0 ? new Date(updated * 1000).toISOString() : undefined };
}

/** Steam's libraryfolders.vdf -> library folders. */
export function parseLibraryFolders(text: string): string[] {
  return [...text.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, "\\"));
}

function steamGame(): InstalledGame | null {
  const steam = regValue("HKCU\\Software\\Valve\\Steam", "SteamPath");
  const roots = new Set<string>();
  if (steam) roots.add(path.normalize(steam));
  try {
    for (const root of [...roots]) {
      for (const lib of parseLibraryFolders(fs.readFileSync(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8"))) roots.add(path.normalize(lib));
    }
  } catch { /* no library list: only the main folder */ }
  for (const root of roots) {
    try {
      const manifest = fs.readFileSync(path.join(root, "steamapps", `appmanifest_${STEAM_APP}.acf`), "utf8");
      return { client: "steam", ...parseAppManifest(manifest) };
    } catch { /* not in this library */ }
  }
  return null;
}

function standaloneGame(): InstalledGame | null {
  const dir = process.env.POB_KB_GAME_DIR || regValue("HKCU\\Software\\GrindingGearGames\\Path of Exile", "InstallLocation");
  if (!dir) return null;
  try {
    const stat = fs.statSync(path.join(dir, "Content.ggpk"));
    return { client: "standalone", updated_at: stat.mtime.toISOString() };
  } catch { return null; }
}

let cached: InstalledGame | null | undefined;

/** The installed PoE1 client, or null. Never throws; looked up once per process. */
export function installedGame(): InstalledGame | null {
  if (cached !== undefined) return cached;
  if (/^(0|off|false)$/i.test(process.env.POB_KB_GAME ?? "")) return (cached = null);
  try { cached = standaloneGame() ?? steamGame(); } catch { cached = null; }
  return cached;
}
