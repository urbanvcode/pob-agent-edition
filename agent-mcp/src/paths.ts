/**
 * Where things live. The server finds PoB Agent Edition relative to itself
 * (<root>/agent-mcp/build/paths.js), so no configuration is needed; the
 * environment variables are overrides for unusual layouts and tests.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository / install root (the folder holding PathOfBuilding, luajit, agent-mcp). */
export const ROOT = process.env.POB_AGENT_ROOT || path.resolve(here, "..", "..");

/** PoB's src folder (holds Agent/Headless.lua). */
export function pobSrc(): string {
  return process.env.POB_PATH || path.join(ROOT, "PathOfBuilding", "src");
}

export function luajitExe(): string {
  if (process.env.POB_CMD) return process.env.POB_CMD;
  const bundled = path.join(ROOT, "luajit", process.platform === "win32" ? "luajit.exe" : "luajit");
  return fs.existsSync(bundled) ? bundled : "luajit";
}

export function livePort(): number {
  return parseInt(process.env.POB_AGENT_PORT || "31337", 10);
}

/** auto: the window when it is open, else headless. only: never headless. off: always headless. */
export function liveMode(): "auto" | "only" | "off" {
  const v = (process.env.POB_LIVE || "auto").toLowerCase();
  return v === "only" ? "only" : v === "off" || v === "false" ? "off" : "auto";
}

/**
 * Portable data mode: an empty portable.txt in the root keeps builds and
 * settings in <root>/UserData. The PoB window reads the same switch
 * (PathOfBuilding/src/Agent/Update.lua).
 */
export function portableMode(): boolean {
  return fs.existsSync(path.join(ROOT, "portable.txt"));
}

/** PoB's user folder: "Documents/Path of Building", or <root>/UserData in portable data mode. */
export function userDir(): string {
  if (process.env.POB_DIRECTORY) return path.dirname(path.resolve(process.env.POB_DIRECTORY));
  if (portableMode()) return path.join(ROOT, "UserData");
  return path.join(os.homedir(), "Documents", "Path of Building");
}

/** The Builds folder. The live window reports its own; this is the fallback. */
export function buildsDir(): string {
  if (process.env.POB_DIRECTORY) return path.resolve(process.env.POB_DIRECTORY);
  return path.join(userDir(), "Builds");
}

/** AgentEdition.json candidates in priority order (profile and POESESSID). */
export function settingsCandidates(): string[] {
  const files: string[] = [];
  if (process.env.POB_AGENT_SETTINGS) files.push(process.env.POB_AGENT_SETTINGS);
  files.push(path.join(userDir(), "AgentEdition.json"));
  return files;
}

/** Cache folder for snapshots and downloaded trade data. */
export function cacheDir(sub: string): string {
  const dir = path.join(process.env.POB_AGENT_CACHE || path.join(userDir(), "AgentCache"), sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Our version: the VERSION file at the root (one source of truth), else package.json. */
function readVersion(): string {
  const semver = /^\d+\.\d+\.\d+\S*/;
  try {
    const m = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim().match(semver);
    if (m) return m[0];
  } catch { /* fall back */ }
  try {
    const m = String(JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).version ?? "").match(semver);
    if (m) return m[0];
  } catch { /* fall back */ }
  return "0.0.0";
}

export const VERSION = readVersion();
export const USER_AGENT = `pob-agent-edition/${VERSION} (agent-mcp)`;
