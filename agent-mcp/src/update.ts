/**
 * "Is a newer PoB Agent Edition out?" for the AI. The PoB window checks
 * GitHub once a day and keeps the answer in AgentEdition.json under "update"
 * (PathOfBuilding/src/Agent/Update.lua; keep the two in sync). This module
 * reads that, refreshes it in the background when it is older than a day
 * (into AgentCache/update.json, never into the player's settings), and
 * gives status one line to mention once per conversation.
 */
import fs from "fs";
import path from "path";
import { cacheDir, ROOT, USER_AGENT, VERSION } from "./paths.js";
import { agentSettingsFile } from "./profile.js";

export const RELEASES_API = "https://api.github.com/repos/urbanvcode/pob-agent-edition/releases?per_page=20";
const DAY_S = 24 * 60 * 60;

interface UpdateState { check?: boolean; checkedAt?: number; latest?: string; url?: string; skip?: string }

function parse(v: string): [number, number, number, string | undefined] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(\S*)$/.exec(String(v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] || undefined] : null;
}

/** -1, 0 or 1. A pre-release suffix sorts before the release. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a), y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) < (y[i] as number) ? -1 : 1;
  if (x[3] === y[3]) return 0;
  if (!x[3]) return 1;
  if (!y[3]) return -1;
  return x[3] < y[3] ? -1 : 1;
}

/** Newest non-draft release in a GitHub /releases list (pre-releases count: every 0.x is one). */
export function pickLatest(list: unknown): { version: string; url?: string } | null {
  let best: { tag: string; url?: string } | null = null;
  for (const rel of Array.isArray(list) ? list : []) {
    const tag = rel && typeof rel === "object" ? (rel as { tag_name?: unknown }).tag_name : undefined;
    if (typeof tag !== "string" || (rel as { draft?: boolean }).draft || !parse(tag)) continue;
    if (!best || compareVersions(tag, best.tag) > 0) best = { tag, url: (rel as { html_url?: string }).html_url };
  }
  return best ? { version: best.tag.replace(/^v/, ""), url: best.url } : null;
}

function readJson(file: string | undefined): Record<string, unknown> {
  if (!file) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function settingsState(): UpdateState {
  const s = readJson(agentSettingsFile()).update;
  return s && typeof s === "object" ? (s as UpdateState) : {};
}

const ownCache = () => path.join(cacheDir("update"), "latest.json");
let refreshing = false;

/** Background refresh into AgentCache (fire and forget; failures are silent). */
function refresh(): void {
  if (refreshing || process.env.POB_AGENT_UPDATE_CHECK === "off") return;
  refreshing = true;
  fetch(RELEASES_API, { headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((list) => {
      const latest = pickLatest(list);
      if (latest) fs.writeFileSync(ownCache(), JSON.stringify({ checkedAt: Math.floor(Date.now() / 1000), ...latest }));
    })
    .catch(() => { /* offline: try again next time */ })
    .finally(() => { refreshing = false; });
}

/** Freshest known release, from the PoB window's check or our own cache. */
export function knownLatest(): { version: string; url?: string; checkedAt: number } | null {
  const s = settingsState();
  const own = readJson(ownCache());
  const fromPob = s.latest ? { version: String(s.latest), url: s.url, checkedAt: Number(s.checkedAt) || 0 } : null;
  const fromOwn = own.version ? { version: String(own.version), url: own.url as string | undefined, checkedAt: Number(own.checkedAt) || 0 } : null;
  const best = [fromPob, fromOwn].filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.checkedAt - a.checkedAt)[0] ?? null;
  if (!best || Date.now() / 1000 - best.checkedAt > DAY_S) refresh();
  return best;
}

export function installType(): "git" | "portable" | "zip" {
  if (fs.existsSync(path.join(ROOT, ".git"))) return "git";
  if (fs.existsSync(path.join(ROOT, "node", "node.exe"))) return "portable";
  return "zip";
}

let mentioned = false;

/** The status line about a newer release, once per server process (one conversation); else null. */
export function updateNotice(): string | null {
  if (mentioned || process.env.POB_AGENT_UPDATE_CHECK === "off") return null;
  const s = settingsState();
  if (s.check === false) return null;
  const latest = knownLatest();
  if (!latest || compareVersions(latest.version, VERSION) <= 0 || s.skip === latest.version) return null;
  mentioned = true;
  return `Update available: PoB Agent Edition v${latest.version} (this is v${VERSION}). Mention it once: the player clicks Update now on the Overview banner (or runs tools\\update.ps1); builds and settings are kept.`;
}
