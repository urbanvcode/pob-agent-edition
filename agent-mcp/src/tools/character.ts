/** Character tools (Stage 2): character_sync (import from pathofexile.com + what changed) and character_history. */
import fs from "fs";
import path from "path";
import {
  CharacterClient, REALMS, asObject, characterHash, configEffectText, diffStates, diffSummary, diffText, dps, findSameCharacterBuilds, historyFile,
  lastSynced, listHistories, maxHit, readHistory, saveSnapshot, updateIndex, writeHistory, type ConfigEffect, type History, type HistoryEntry,
} from "../character.js";
import { levellingSyncLine } from "../levelling.js";
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

const signed = (v: number) => `${v >= 0 ? "+" : ""}${fmt(v)}`;
const pctOf = (from: number, to: number) => (from > 0 ? ` (${to >= from ? "+" : ""}${(((to - from) / from) * 100).toFixed(0)}%)` : "");

/**
 * First sync: the new build starts with PoB's default Configuration. If another
 * build in the Builds folder is clearly the same character, say which of its
 * fight settings differ and what they do to DPS (simulated, rolled back), with
 * the edit ops that copy them. Returns the lines and a short summary note.
 */
async function freshConfigLines(pob: Pob, link: any, dir: string, file: string, name: string, entry: HistoryEntry, character: string): Promise<{ lines: string[]; note?: string }> {
  const cands = findSameCharacterBuilds(dir, character, entry.className, entry.ascendancy, [file]).slice(0, 3);
  for (const c of cands) {
    try {
      const side = await pob.sideLink();
      await side.call("load_build_xml", { xml: fs.readFileSync(c.file, "utf8"), name: c.name });
      const prof = await side.call("config_profile");
      if (!prof?.ok) continue;
      if (prof.mainSkill && entry.mainSkill && prof.mainSkill !== entry.mainSkill) continue;
      const eff: ConfigEffect & { ok: boolean } = await link.call("config_effect", { config: asObject(prof.config), gems: asObject<boolean>(prof.gems) });
      if (!eff?.ok) break;
      const who = `"${c.name}" (the same character${c.byImport ? ", an import of it" : ", by its name"})`;
      if (!eff.ops?.length) return { lines: [`FIGHT SETTINGS: same as ${who}.`] };
      const d0 = dps(eff.before ?? {}), d1 = dps(eff.after ?? {});
      return {
        lines: [
          `FIGHT SETTINGS: this new build starts with PoB's default Configuration, and ${who} has different ones: ${configEffectText(eff)}.`,
          `With those settings PoB's DPS for the synced build is ${fmt(d1)} instead of ${fmt(d0)}${pctOf(d0, d1)} (simulated, nothing changed). Ask the player which settings match their fights; to copy them: edit { ops: ${JSON.stringify(eff.ops)} } (what_if previews it), then save_build.`,
        ],
        note: `fresh config; "${c.name}" has other fight settings (DPS ${fmt(d1)} with them)`,
      };
    } catch { /* try the next one */ }
  }
  return { lines: [`FIGHT SETTINGS: new build with PoB's default Configuration (no other build of this character found). Set the charges, buffs and enemy the player really fights with (set_config), or the DPS can be far off.`], note: "fresh config" };
}

/** Later syncs: how much of the DPS change comes from fight settings changed since the last sync, and how much from gear. */
async function configChangeLines(link: any, before: HistoryEntry, entry: HistoryEntry): Promise<{ lines: string[]; mostly: boolean }> {
  if (!before.fight || !entry.fight) return { lines: [], mostly: false };
  let eff: ConfigEffect & { ok: boolean };
  try { eff = await link.call("config_effect", { config: before.fight.config, gems: before.fight.gems }); } catch { return { lines: [], mostly: false }; }
  if (!eff?.ok || !eff.ops?.length) return { lines: [], mostly: false };
  const prev = dps(before.stats), now = dps(entry.stats), oldCfg = dps(eff.after ?? {});
  const fromConfig = now - oldCfg, fromGear = oldCfg - prev;
  const mostly = Math.abs(fromConfig) > Math.abs(fromGear) && Math.abs(fromConfig) > Math.max(prev, 1) * 0.01;
  return {
    lines: [`${mostly ? "DPS CHANGED MOSTLY BY CONFIG: " : ""}DPS ${fmt(prev)} -> ${fmt(now)}: ${signed(fromGear)} from gear, gems and passives, ${signed(fromConfig)} from fight settings changed since the last sync (${configEffectText(eff, true)}).`],
    mostly,
  };
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
          return `Which character? ${account} has: ${names.join(", ")}. Call character again with character.`;
        }
        // Polite: no second download of the same character within a minute.
        const prevFile = listHistories().find((h) => h.history.character.toLowerCase() === character.toLowerCase() && h.history.realm === realm);
        const prevAt = prevFile?.history.entries.at(-1)?.at;
        if (prevAt && Date.now() - Date.parse(prevAt) < MIN_RESYNC_MS) {
          throw new ToolError(`${prevFile!.history.character} was synced ${Math.round((Date.now() - Date.parse(prevAt)) / 1000)} s ago; use character { history: true }, or sync again in a minute.`);
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
        const fresh = !fs.existsSync(file);
        if (!fresh) {
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
        // Fight settings (Configuration and which skills are on): kept with the entry, so the next sync can tell config from gear.
        try {
          const prof = await link.call("config_profile");
          if (prof?.ok) entry.fight = { config: asObject(prof.config), gems: asObject<boolean>(prof.gems) };
        } catch { /* optional */ }
        let fightLines: string[] = [];
        if (fresh && !before) {
          const r = await freshConfigLines(pob, link, dir, file, name, entry, dl.character.name);
          fightLines = r.lines;
          if (r.note) entry.summary += `; ${r.note}`;
        } else if (before) {
          const r = await configChangeLines(link, before, entry);
          fightLines = r.lines;
          if (r.mostly) entry.summary += ", DPS change mostly from config";
        }
        history.entries.push(entry);
        writeHistory(hFile, history);
        updateIndex(history);

        const s = entry.stats;
        // Live levelling tracking (Stage 7): where the synced character stands and what is next.
        const levelling = (entry.level ?? 100) < 90 ? await levellingSyncLine(pob) : undefined;
        const lines = [
          `Synced ${dl.character.name} (${dl.character.league}): level ${entry.level} ${entry.className}${entry.ascendancy && entry.ascendancy !== "None" ? ` (${entry.ascendancy})` : ""}, main skill ${entry.mainSkill ?? "none"}.`,
          `Build "${name}" saved to ${file}${link.kind === "live" ? " and open in the PoB window" : ""}. ${dl.requests} requests to pathofexile.com.`,
          `Now: DPS ${fmt(dps(s))}, EHP ${fmt(s.TotalEHP ?? 0)}, weakest max hit ${fmt(maxHit(s))}, life ${fmt(s.Life ?? 0)}, ES ${fmt(s.EnergyShield ?? 0)}, res ${s.FireResist}/${s.ColdResist}/${s.LightningResist}/${s.ChaosResist}.`,
          ...(levelling ? [levelling] : []),
          ...(imported.keptOff?.length ? [`Kept switched off, as in this build before the sync (the game does not say which auras are on): ${imported.keptOff.join(", ")}.`] : []),
          "",
          ...fightLines,
          ...(diff ? [`CHANGES since ${day(before!.at)} UTC:`, ...diffText(diff)] : ["First sync: this is the baseline. The next sync lists what changed."]),
          "",
          `PoB recalculated everything from the imported character; ${fresh ? "new build, PoB's default config" : "config kept"} (bandit, pantheon and resistance penalty set by PoB's importer). Config assumptions: ${entry.assumptions ?? "?"}`,
          `History: ${history.entries.length} sync(s); character { history: true } shows the timeline, the Overview "Progress" card draws it.`,
        ];
        return lines.join("\n");
      }),

    tool("character_history", "Timeline of a synced character: level, DPS, EHP, max hit, life and what changed at each sync.",
      { character: S.str("Default: last synced"), limit: S.num() }, [],
      async (_ctx, args) => {
        const all = listHistories();
        if (!all.length) return "No character synced yet. Use character (account Name#1234 + character).";
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
