/**
 * Finding the Claude Code and Codex command-line programs (Stage 10).
 * Order: an override (env or the chat settings), PATH, then the places the
 * official installers and the desktop apps put them. Paths are only used to
 * start the program; the chat panel shows "found", never the path.
 */
import fs from "fs";
import os from "os";
import path from "path";

export type CliName = "claude" | "codex";

function exists(p: string | undefined): p is string {
  try { return !!p && fs.statSync(p).isFile(); } catch { return false; }
}

function onPath(names: string[]): string | undefined {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) for (const n of names) {
    const p = path.join(dir, n);
    if (exists(p)) return p;
  }
  return undefined;
}

function subdirs(dir: string): string[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)); } catch { return []; }
}

/** "2.1.321" -> comparable tuple; non-versions sort last. */
function versionKey(name: string): number[] {
  const m = path.basename(name).match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [-1, -1, -1];
}
function newerFirst(a: string, b: string): number {
  const ka = versionKey(a), kb = versionKey(b);
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
  return 0;
}
function mtime(p: string): number { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

/** Claude Code bundled with the Claude desktop app: <data>/claude-code/<version>/[<hash>/]claude.exe */
function desktopClaude(): string | undefined {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const roaming = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  const roots = [path.join(roaming, "Claude", "claude-code"), path.join(local, "AnthropicClaude", "claude-code")];
  for (const d of subdirs(path.join(local, "Claude-Data"))) roots.push(path.join(d, "claude-code"));
  const found: string[] = [];
  for (const root of roots) {
    for (const ver of subdirs(root).sort(newerFirst)) {
      const direct = path.join(ver, "claude.exe");
      if (exists(direct)) { found.push(direct); continue; }
      const nested = subdirs(ver).map((h) => path.join(h, "claude.exe")).filter(exists).sort((a, b) => mtime(b) - mtime(a));
      if (nested.length) found.push(nested[0]);
    }
  }
  return found.sort((a, b) => newerFirst(versionDir(a), versionDir(b)))[0];
}
function versionDir(exe: string): string {
  let d = path.dirname(exe);
  while (d && !/^\d+\.\d+\.\d+/.test(path.basename(d)) && path.dirname(d) !== d) d = path.dirname(d);
  return d;
}

/** Codex bundled with the Codex desktop app: %LOCALAPPDATA%/OpenAI/Codex/bin/<hash>/codex.exe (newest). */
function desktopCodex(): string | undefined {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return subdirs(path.join(local, "OpenAI", "Codex", "bin")).map((d) => path.join(d, "codex.exe")).filter(exists).sort((a, b) => mtime(b) - mtime(a))[0];
}

export interface Found { path: string; source: "override" | "path" | "install" | "desktop app" }

export function findCli(name: CliName, override?: string): Found | undefined {
  const env = name === "claude" ? process.env.POB_CHAT_CLAUDE : process.env.POB_CHAT_CODEX;
  for (const o of [env, override]) if (exists(o)) return { path: o, source: "override" };
  const win = process.platform === "win32";
  const onP = onPath(win ? [`${name}.exe`, `${name}.cmd`] : [name]);
  if (onP) return { path: onP, source: "path" };
  const home = os.homedir();
  const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  const installs = name === "claude"
    ? [path.join(home, ".local", "bin", win ? "claude.exe" : "claude"), path.join(home, ".claude", "local", win ? "claude.exe" : "claude"), path.join(roaming, "npm", "claude.cmd")]
    : [path.join(roaming, "npm", "codex.cmd"), path.join(home, ".local", "bin", win ? "codex.exe" : "codex")];
  const inst = installs.find(exists);
  if (inst) return { path: inst, source: "install" };
  const desk = name === "claude" ? desktopClaude() : desktopCodex();
  return desk ? { path: desk, source: "desktop app" } : undefined;
}
