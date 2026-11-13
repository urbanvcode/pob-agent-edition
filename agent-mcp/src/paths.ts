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

/** PoB's user folder: "Documents/Path of Building". */
export function userDir(): string {
  if (process.env.POB_DIRECTORY) return path.dirname(path.resolve(process.env.POB_DIRECTORY));
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

export const VERSION = "0.2.0";
export const USER_AGENT = `pob-agent-edition/${VERSION} (agent-mcp)`;
