/** Session tools: what is open, opening and saving builds, the window's tab, and the player profile. */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { buildsDir } from "../paths.js";
import { ToolError, type Pob } from "../pob.js";
import { formatProfile, getProfile, markLearned, profileSummaryLine, updateProfile, type ProfileUpdate } from "../profile.js";
import { S, tool, type Tool } from "../registry.js";

interface LiveState {
  mode: string;
  buildName?: string;
  file?: string;
  unsaved?: boolean;
  viewMode?: string;
  className?: string;
  ascendancy?: string;
  level?: number;
  buildsPath?: string;
}

async function liveState(pob: Pob): Promise<LiveState | null> {
  if (!(await pob.isLive())) return null;
  const link = await pob.link(false);
  if (link.kind !== "live") return null;
  return (await link.call("get_live_state")).state as LiveState;
}

export async function currentBuildsDir(pob: Pob): Promise<string> {
  const state = await liveState(pob).catch(() => null);
  return state?.buildsPath ? path.resolve(state.buildsPath) : buildsDir();
}

function listXml(dir: string, base = dir, out: Array<{ name: string; file: string; mtime: number }> = []) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listXml(full, base, out);
    else if (e.name.toLowerCase().endsWith(".xml")) {
      out.push({ name: path.relative(base, full).replace(/\\/g, "/").replace(/\.xml$/i, ""), file: full, mtime: fs.statSync(full).mtimeMs });
    }
  }
  return out;
}

/** A build name (optionally with sub-folders) -> a file inside the Builds folder. */
export function buildFile(dir: string, name: string): string {
  const clean = name.trim().replace(/\.xml$/i, "");
  if (!clean) throw new ToolError("Build name is empty.");
  if (/[<>:"|?*]/.test(clean.replace(/^[A-Za-z]:/, ""))) throw new ToolError(`"${name}" has characters Windows does not allow in file names (< > : " | ? *).`);
  const file = path.resolve(dir, clean + ".xml");
  if (path.relative(dir, file).startsWith("..") || path.isAbsolute(path.relative(dir, file))) {
    throw new ToolError(`Builds must stay inside the Builds folder (${dir}).`);
  }
  return file;
}

function findBuild(dir: string, name: string): string {
  const exact = buildFile(dir, name);
  if (fs.existsSync(exact)) return exact;
  const all = listXml(dir);
  const want = name.trim().replace(/\.xml$/i, "").toLowerCase();
  const hit = all.find((b) => b.name.toLowerCase() === want) ?? all.find((b) => path.basename(b.name).toLowerCase().trim() === want);
  if (hit) return hit.file;
  const near = all.filter((b) => b.name.toLowerCase().includes(want)).slice(0, 5).map((b) => `"${b.name}"`);
  throw new ToolError(`No build named "${name}" in ${dir}.${near.length ? ` Did you mean ${near.join(", ")}?` : " Use list_builds to see the names."}`);
}

/** PoB export code (base64url + zlib) or raw XML -> XML. */
export function decodeBuildCode(code: string): string {
  const text = code.trim();
  if (text.startsWith("<")) return text;
  if (/^https?:\/\//i.test(text)) throw new ToolError("Links are not fetched here. Ask the player to paste the PoB export code itself (PoB > Import/Export > Generate).");
  try {
    return zlib.inflateSync(Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf8");
  } catch {
    throw new ToolError("That is not a valid PoB export code (expected the text from PoB > Import/Export > Generate).");
  }
}

export async function statusText(pob: Pob): Promise<string> {
  const lines: string[] = [];
  const state = await liveState(pob);
  if (state) {
    lines.push("Mode: live PoB Agent Edition window (edits show up in the window at once)");
    if (state.mode !== "BUILD") {
      lines.push("Window shows the build list. Open a build: list_builds, then open_build.");
    } else {
      lines.push(`Build: ${state.buildName ?? "Unnamed"}${state.unsaved ? " (UNSAVED CHANGES)" : ""}`);
      lines.push(`File: ${state.file ?? "(not saved to a file yet)"}`);
      lines.push(`Character: level ${state.level ?? "?"} ${state.className ?? "?"}${state.ascendancy && state.ascendancy !== "None" ? ` (${state.ascendancy})` : ""}`);
      lines.push(`Tab: ${state.viewMode ?? "?"}`);
    }
  } else {
    lines.push("Mode: headless (PoB Agent Edition is not open; saved build files only, the player sees nothing)");
    if (pob.headlessBuild) {
      lines.push(`Build: ${pob.headlessBuild.name}`);
      lines.push(`File: ${pob.headlessBuild.file ?? "(imported, no file)"}`);
    } else {
      lines.push("No build loaded. Use list_builds, then open_build. For live editing ask the player to start PoB Agent Edition.");
    }
  }
  try { lines.push(profileSummaryLine(getProfile().profile)); } catch { /* profile is optional */ }
  return lines.join("\n");
}

const VIEWS = ["OVERVIEW", "ATLAS", "TREE", "SKILLS", "ITEMS", "CALCS", "CONFIG", "NOTES", "IMPORT", "PARTY", "COMPARE"];

export const sessionTools: Tool[] = [
  tool("status", "What PoB has open: live window or headless, build, unsaved changes, tab, player profile line. Call after profile_get.", {}, [],
    async ({ pob }) => statusText(pob)),

  tool("list_builds", "Saved builds in the Builds folder, newest first.", { filter: S.str("Text the name must contain") }, [],
    async ({ pob }, args) => {
      const dir = await currentBuildsDir(pob);
      const filter = typeof args.filter === "string" ? args.filter.toLowerCase() : "";
      const builds = listXml(dir).filter((b) => !filter || b.name.toLowerCase().includes(filter)).sort((a, b) => b.mtime - a.mtime);
      if (!builds.length) return `No builds${filter ? ` matching "${args.filter}"` : ""} in ${dir}.`;
      const shown = builds.slice(0, 40);
      return [`${builds.length} build(s) in ${dir}:`, ...shown.map((b) => `- ${b.name} (${new Date(b.mtime).toISOString().slice(0, 10)})`),
        ...(builds.length > shown.length ? [`... ${builds.length - shown.length} more; use filter.`] : [])].join("\n");
    }),

  tool("open_build", "Open a saved build by name, or import a PoB export code. In the live window this replaces what is open: refused when there are unsaved changes unless discard_unsaved is true (ask the player first).",
    { name: S.str("Build name from list_builds"), code: S.str("PoB export code or build XML"), discard_unsaved: S.bool() }, [],
    async ({ pob }, args) => {
      if (!args.name && !args.code) throw new ToolError("Give name (from list_builds) or code (a PoB export code).");
      const state = await liveState(pob);
      if (state?.mode === "BUILD" && state.unsaved && args.discard_unsaved !== true) {
        throw new ToolError(`"${state.buildName}" has unsaved changes in the PoB window. Ask the player whether to save them (save_build) or discard them (open_build with discard_unsaved: true).`);
      }
      const link = await pob.link(false);
      if (args.code) {
        const xml = decodeBuildCode(String(args.code));
        const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : "Imported build";
        await link.call("load_build_xml", { xml, name });
        if (link.kind === "headless") pob.headlessBuild = { name };
        return `Imported "${name}" as a new unsaved build${link.kind === "live" ? " in the PoB window" : " (headless)"}. Use save_build with a name to keep it.`;
      }
      const dir = await currentBuildsDir(pob);
      const file = findBuild(dir, String(args.name));
      const name = path.basename(file).replace(/\.xml$/i, "");
      if (link.kind === "live") {
        const res = await link.call("open_build_file", { path: file, name });
        return `Opened "${res.name ?? name}" in the PoB window.\nFile: ${res.file ?? file}`;
      }
      await link.call("load_build_xml", { xml: fs.readFileSync(file, "utf8"), name });
      pob.headlessBuild = { name, file };
      return `Loaded "${name}" in the headless engine (PoB Agent Edition is not open, so the player sees nothing).\nFile: ${file}`;
    }),

  tool("save_build", "Save the open build. Always pass a new name for AI changes, e.g. \"<build> - AI <change>\"; never overwrite the player's file unless they asked (then overwrite: true).",
    { name: S.str("New build name"), overwrite: S.bool("Player asked to overwrite") }, [],
    async ({ pob }, args) => {
      const link = await pob.link();
      const dir = await currentBuildsDir(pob);
      const state = link.kind === "live" ? await liveState(pob) : null;
      const currentFile = state?.file ?? pob.headlessBuild?.file;
      let file: string;
      if (typeof args.name === "string" && args.name.trim()) {
        file = buildFile(dir, args.name);
        if (fs.existsSync(file) && args.overwrite !== true) {
          throw new ToolError(`"${args.name}" already exists. Pick another name, or pass overwrite: true if the player asked to replace it.`);
        }
      } else {
        if (!currentFile) throw new ToolError("This build has no file yet: pass name.");
        if (args.overwrite !== true) {
          throw new ToolError(`Saving without a name would overwrite the player's file (${path.basename(currentFile)}). Pass a new name such as "${path.basename(currentFile).replace(/\.xml$/i, "")} - AI <change>", or overwrite: true if the player asked for it.`);
        }
        file = currentFile;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const name = path.basename(file).replace(/\.xml$/i, "");
      if (link.kind === "live") {
        const res = await link.call("save_live_build", file === currentFile ? {} : { path: file.replace(/\\/g, "/"), name });
        return `Saved to ${res.file}. The PoB window now works on this file.`;
      }
      await link.call("save_build", { path: file });
      pob.headlessBuild = { name, file };
      return `Saved to ${file}.`;
    }),

  tool("set_view", "Switch the PoB window to a tab so the player sees what you are talking about.", { view: S.enum(VIEWS) }, ["view"],
    async ({ pob }, args) => {
      const link = await pob.link();
      if (link.kind !== "live") return "No PoB window is open (headless mode), nothing to switch.";
      const res = await link.call("set_view", { view: args.view });
      return `PoB window switched to the ${res.view} tab.`;
    }),

  tool("open_options", "Open PoB's Options window (Agent profile, POESESSID) for the player.", {}, [],
    async ({ pob }) => {
      const link = await pob.link(false);
      if (link.kind !== "live") return "No PoB window is open. Ask the player to start PoB Agent Edition; the profile can also be changed with profile_set.";
      await link.call("open_options");
      return "Options is open in the PoB window (Agent profile section; the POESESSID field is there too).";
    }),
];

export function profileTools(checkLeague: (league: string) => Promise<{ league: string; note?: string }>): Tool[] {
  return [
    tool("profile_get", "The player's profile (trade/SSF, hardcore, league, currency, goals, explanation mode) and how to answer for it. Call first, once per conversation.", {}, [],
      async () => {
        const { profile, file, stored } = getProfile();
        return formatProfile(profile, file, stored);
      }),

    tool("profile_set", "Update the profile. Only when the player asks or states a fact (\"I have 300c\", \"I'm SSF now\").",
      {
        playMode: S.enum(["trade", "ssf", "mixed"]), hardcore: S.bool(), league: S.str("\"\" = current challenge league"),
        currency: { type: "object", properties: { chaos: S.num(), divine: S.num(), other: S.str() } },
        goals: S.list(S.str(), "Replaces all goals"), add_goals: S.list(S.str()), remove_goals: S.list(S.str()),
        experience: S.enum(["poe2", "new", "poe1"]), explanationMode: S.enum(["teach", "concise", "deep"]), reset_learned: S.bool(),
      }, [],
      async (_ctx, args) => {
        const update: ProfileUpdate = { ...args };
        let note: string | undefined;
        if (typeof update.league === "string" && update.league.trim()) {
          const checked = await checkLeague(update.league.trim());
          update.league = checked.league;
          note = checked.note;
        }
        const { profile, changed, file } = updateProfile(update);
        const hcLeague = /hardcore|\bhc\b/i.test(profile.league);
        if (profile.league && profile.hardcore !== hcLeague) {
          note = [note, `Check: profile is ${profile.hardcore ? "Hardcore" : "softcore"} but league "${profile.league}" looks ${hcLeague ? "Hardcore" : "softcore"}.`].filter(Boolean).join(" ");
        }
        return [
          changed.length ? `Profile updated: ${changed.join(", ")}.` : "No changes (values already set).",
          ...(note ? [note] : []),
          "PoB Agent Edition shows the new profile in the Overview header within a few seconds.",
          "",
          formatProfile(profile, file, true),
        ].join("\n");
      }),

    tool("profile_mark_learned", "Teach mode: record PoE1 topics you just explained so they are not explained again.",
      { topics: S.list(S.str()) }, ["topics"],
      async (_ctx, args) => {
        const topics = Array.isArray(args.topics) ? args.topics.map(String) : [];
        if (!topics.length) throw new ToolError("topics must list at least one topic, e.g. [\"spell suppression\"].");
        const { profile, added } = markLearned(topics);
        const lines = [
          added.length ? `Marked as explained: ${added.join(", ")}.` : "Already marked as explained.",
          `Learned topics (${profile.learnedTopics.length}): ${profile.learnedTopics.join(", ")}`,
        ];
        if (profile.explanationMode !== "teach") lines.push(`(Explanation mode is ${profile.explanationMode}; learned topics matter most in Teach mode.)`);
        return lines.join("\n");
      }),
  ];
}
