/** Character tools (Stage 2): character_sync (import from pathofexile.com + what changed) and character_history. */
import fs from "fs";
import path from "path";
import {
  CharacterClient, REALMS, characterHash, diffStates, diffSummary, diffText, dps, historyFile, lastSynced, listHistories,
  maxHit, readHistory, saveSnapshot, updateIndex, writeHistory, type History, type HistoryEntry,
} from "../character.js";
import { ToolError, type Pob } from "../pob.js";
import { S, tool, type Tool } from "../registry.js";
import { buildFile, currentBuildsDir } from "./session.js";

/** A sync within this time returns an error instead of downloading again (be polite to GGG). */
const MIN_RESYNC_MS = 60_000;

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const day = (at: string) => at.slice(0, 16).replace("T", " ");

async function liveState(pob: Pob): Promise<{ mode: string; file?: string; unsaved?: boolean; buildName?: string } | null> {
  if (!(await pob.isLive())) return null;
  const link = await pob.link(false);
  if (link.kind !== "live") return null;
  return (await link.call("get_live_state")).state;
}

const samePath = (a?: string, b?: string) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function characterTools(client = new CharacterClient()): Tool[] {
  return [
    tool("character_sync", "Import the player's character from their public pathofexile.com profile into its own build \"<character> - synced\" (other builds untouched) and list what changed since the last sync: items, gems, passives, with DPS/EHP/max-hit deltas from PoB. Names are remembered after the first sync. Read-only, no login.",
      { account: S.str("Name#1234"), character: S.str(), realm: S.enum(REALMS), discard_unsaved: S.bool() }, [],
      async ({ pob }, args) => {
        const last = lastSynced();
        const account = typeof args.account === "string" && args.account.trim() ? args.account.trim() : last?.account;
        const character = typeof args.character === "string" && args.character.trim() ? args.character.trim() : (account === last?.account ? last?.character : undefined);
        const realm = typeof args.realm === "string" ? args.realm : (last?.realm ?? "pc");
        if (!account) throw new ToolError("Ask the player for their pathofexile.com account name (with the #1234 tag) and character name; the profile's Characters tab must be public.");
        if (!character) {
          const list = await client.characters(account.replace(/^(.*)-(\d{4})$/, "$1#$2"), realm);
          const names = list.sort((a, b) => b.level - a.level).slice(0, 15).map((c) => `${c.name} (${c.level} ${c.class}, ${c.league})`);
          return `Which character? ${account} has: ${names.join(", ")}. Call character_sync again with character.`;
        }
        // Polite: no second download of the same character within a minute.
        const prevFile = listHistories().find((h) => h.history.character.toLowerCase() === character.toLowerCase() && h.history.realm === realm);
        const prevAt = prevFile?.history.entries.at(-1)?.at;
        if (prevAt && Date.now() - Date.parse(prevAt) < MIN_RESYNC_MS) {
          throw new ToolError(`${prevFile!.history.character} was synced ${Math.round((Date.now() - Date.parse(prevAt)) / 1000)} s ago; use character_history, or sync again in a minute.`);
        }

        // Where the import goes: the character's own build file.
        const dir = await currentBuildsDir(pob);
        const state = await liveState(pob);
        // Checked before downloading, so a refusal costs no requests.
        if (state?.mode === "BUILD" && state.unsaved && !samePath(state.file, buildFile(dir, `${character} - synced`)) && args.discard_unsaved !== true) {
          throw new ToolError(`"${state.buildName}" has unsaved changes in the PoB window and the sync opens "${character} - synced". Ask the player to save first (save_build), or pass discard_unsaved: true if they agree to drop them.`);
        }
        const dl = await client.download(account, character, realm);
        const name = `${dl.character.name} - synced`;
        const file = buildFile(dir, name);
        const link = await pob.link(false);
        if (fs.existsSync(file)) {
          if (link.kind === "live") await link.call("open_build_file", { path: file, name });
          else await link.call("load_build_xml", { xml: fs.readFileSync(file, "utf8"), name });
        } else {
          await link.call("new_build", { name });
        }
        const imported = await link.call("character_import", {
          character: dl.character, items: dl.items, passives: dl.passives, realm, name,
          accountHash: characterHash(dl.account),
        });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (link.kind === "live") await link.call("save_live_build", { path: file.replace(/\\/g, "/"), name });
        else { await link.call("save_build", { path: file }); pob.headlessBuild = { name, file }; }
        const { xml } = await link.call("export_build_xml");
        if (link.kind === "live") await link.call("set_view", { view: "OVERVIEW" }).catch(() => undefined); // the Progress card

        // History
        const hFile = historyFile(realm, dl.account, dl.character.name);
        const history: History = readHistory(hFile) ?? {
          version: 1, account: dl.account, realm, character: dl.character.name, characterHash: characterHash(dl.character.name), entries: [],
        };
        history.league = dl.character.league;
        history.build = name;
        const at = new Date().toISOString();
        const entry: HistoryEntry = { ...imported.state, at, league: dl.character.league };
        delete (entry as any).characterHash;
        try { entry.snapshot = path.basename(saveSnapshot(hFile, at, String(xml))); } catch { /* snapshot is optional */ }
        const before = history.entries.at(-1);
        const diff = before ? diffStates(before, entry) : null;
        entry.summary = diff ? diffSummary(diff) : "first sync";
        history.entries.push(entry);
        writeHistory(hFile, history);
        updateIndex(history);

        const s = entry.stats;
        const lines = [
          `Synced ${dl.character.name} (${dl.character.league}): level ${entry.level} ${entry.className}${entry.ascendancy && entry.ascendancy !== "None" ? ` (${entry.ascendancy})` : ""}, main skill ${entry.mainSkill ?? "none"}.`,
          `Build "${name}" saved to ${file}${link.kind === "live" ? " and open in the PoB window" : ""}. ${dl.requests} requests to pathofexile.com.`,
          `Now: DPS ${fmt(dps(s))}, EHP ${fmt(s.TotalEHP ?? 0)}, weakest max hit ${fmt(maxHit(s))}, life ${fmt(s.Life ?? 0)}, ES ${fmt(s.EnergyShield ?? 0)}, res ${s.FireResist}/${s.ColdResist}/${s.LightningResist}/${s.ChaosResist}.`,
          "",
          ...(diff ? [`CHANGES since ${day(before!.at)} UTC:`, ...diffText(diff)] : ["First sync: this is the baseline. The next sync lists what changed."]),
          "",
          `PoB recalculated everything from the imported character; config kept (bandit, pantheon and resistance penalty set by PoB's importer). Config assumptions: ${entry.assumptions ?? "?"}`,
          `History: ${history.entries.length} sync(s); character_history shows the timeline, the Overview "Progress" card draws it.`,
        ];
        return lines.join("\n");
      }),

    tool("character_history", "Timeline of a synced character: level, DPS, EHP, max hit, life and what changed at each sync.",
      { character: S.str("Default: last synced"), limit: S.num() }, [],
      async (_ctx, args) => {
        const all = listHistories();
        if (!all.length) return "No character synced yet. Use character_sync (account Name#1234 + character).";
        const want = typeof args.character === "string" ? args.character.trim().toLowerCase() : lastSynced()?.character.toLowerCase();
        const hit = all.find((h) => h.history.character.toLowerCase() === want) ?? (args.character ? undefined : all[0]);
        if (!hit) throw new ToolError(`No history for "${args.character}". Synced: ${all.map((h) => h.history.character).join(", ")}.`);
        const h = hit.history;
        const limit = Math.min(Math.max(Number(args.limit) || 12, 1), 100);
        const entries = h.entries.slice(-limit);
        const first = h.entries[0], last = h.entries.at(-1)!;
        const lines = [
          `${h.character} (${h.league ?? "?"}), ${h.entries.length} sync(s) since ${day(first.at)} UTC; build "${h.build ?? "?"}".`,
          "date (UTC) | level | DPS | EHP | weakest max hit | life | ES | changes",
          ...entries.map((e) => `${day(e.at)} | ${e.level} | ${fmt(dps(e.stats))} | ${fmt(e.stats.TotalEHP ?? 0)} | ${fmt(maxHit(e.stats))} | ${fmt(e.stats.Life ?? 0)} | ${fmt(e.stats.EnergyShield ?? 0)} | ${e.summary ?? ""}`),
        ];
        if (h.entries.length > 1) {
          const d = diffStates(first, last);
          lines.push("", `Since the first sync: ${diffSummary(d)}.`);
        }
        if (all.length > 1) lines.push(`Other synced characters: ${all.filter((x) => x !== hit).map((x) => x.history.character).join(", ")}.`);
        lines.push(`Numbers are PoB's at each sync (config as it was then). Snapshots: ${hit.file.replace(/\.json$/, "")}`);
        return lines.join("\n");
      }),
  ];
}
