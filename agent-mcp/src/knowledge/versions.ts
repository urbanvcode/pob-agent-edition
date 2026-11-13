/**
 * Which Path of Exile 1 version is live, from two sources: GGG's patch-notes
 * forum (official) and the wiki's version table (release dates). The installed
 * client is the freshness signal: patched after our data was read -> re-check.
 */
import type { PoliteFetcher } from "./fetcher.js";
import { installedGame, type InstalledGame } from "./sources/game.js";
import type { GggPatchNotes, PatchThread } from "./sources/ggg.js";
import type { Wiki } from "./sources/poewiki.js";
import { compareVersions, majorOf, type Fact, type GameVersion } from "./types.js";

export interface VersionInfo {
  current: GameVersion;
  /** A newer version GGG has announced (content update thread) that is not live yet. */
  announced?: GameVersion & { url: string };
  /** The citable fact behind `current`. */
  fact: Fact;
  installed: InstalledGame | null;
  /** Every dated version we know, newest first. */
  known: GameVersion[];
  threads: PatchThread[];
  notes: string[];
}

export interface VersionsOptions {
  now?: () => number;
  game?: () => InstalledGame | null;
  /** Fallback when no site can be reached: the game version PoB's data is for. */
  fallback?: () => string | undefined;
}

export class Versions {
  private memo?: { at: number; info: VersionInfo };
  private readonly now: () => number;
  private readonly game: () => InstalledGame | null;

  constructor(private readonly wiki: Wiki, private readonly ggg: GggPatchNotes, private readonly fetcher: PoliteFetcher, private readonly options: VersionsOptions = {}) {
    this.now = options.now ?? Date.now;
    this.game = options.game ?? installedGame;
  }

  async info(refresh = false): Promise<VersionInfo> {
    if (!refresh && this.memo && this.now() - this.memo.at < 5 * 60_000) return this.memo.info;
    let info = await this.read(refresh);
    // Freshness: the client was patched after we last looked -> look again now.
    const patched = info.installed?.updated_at;
    if (!refresh && patched && Date.parse(patched) > Date.parse(info.fact.retrieved_at) && !this.fetcher.offline) {
      info = await this.read(true);
      info.notes.push("The installed game was patched after the version data was last read, so the version was re-checked.");
    }
    this.memo = { at: this.now(), info };
    return info;
  }

  private async read(refresh: boolean): Promise<VersionInfo> {
    const notes: string[] = [];
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const wiki = await this.wiki.versions(refresh).catch((error: Error) => { notes.push(`Wiki version table not available: ${error.message}`); return undefined; });
    const forum = await this.ggg.list(1, refresh).catch((error: Error) => { notes.push(`GGG patch-notes forum not available: ${error.message}`); return undefined; });
    const known = (wiki?.versions ?? []).slice().sort((a, b) => compareVersions(b.version, a.version));
    const threads = forum?.threads ?? [];
    const installed = this.game();

    const wikiLive = known.find((v) => v.released && v.released <= today);
    const gggLive = threads.filter((t) => !t.contentUpdate).sort((a, b) => compareVersions(b.version, a.version))[0];
    let current: GameVersion | undefined = wikiLive;
    if (gggLive && (!current || compareVersions(gggLive.version, current.version) > 0)) {
      current = { version: gggLive.version, released: known.find((v) => v.version === gggLive.version)?.released };
    }
    const newest = threads.slice().sort((a, b) => compareVersions(b.version, a.version))[0];
    const announced = newest && current && compareVersions(newest.version, current.version) > 0
      ? { version: newest.version, released: known.find((v) => v.version === newest.version)?.released, url: newest.url } : undefined;

    const retrieved = forum?.retrieved_at ?? wiki?.retrieved_at ?? new Date(this.now()).toISOString();
    let fact: Fact;
    if (!current) {
      const fallback = this.options.fallback?.();
      current = { version: fallback ? `${fallback}.0` : "unknown" };
      notes.push(fallback ? `No site could be reached: assuming the version PoB's data is for (${fallback}). It may be older than the live game.` : "The current game version could not be determined.");
      fact = { source: "pob", title: "Current game version (assumed)", text: `Assumed ${current.version}: the version Path of Building's data is for.`, url: "https://github.com/PathOfBuildingCommunity/PathOfBuilding", game: "poe1", game_version: current.version, retrieved_at: retrieved, kind: "version", flags: ["not verified against GGG or the wiki"] };
    } else {
      const thread = threads.find((t) => t.version === current!.version);
      fact = thread
        ? { source: "ggg", title: thread.title, text: `Path of Exile ${current.version}${current.released ? `, released ${current.released} (date from poewiki's version table)` : ""}.`, url: thread.url, game: "poe1", game_version: current.version, retrieved_at: forum!.retrieved_at, kind: "version" }
        : { source: "poewiki", title: "Version history", text: `Path of Exile ${current.version}, released ${current.released}.`, url: wiki!.url, game: "poe1", game_version: current.version, retrieved_at: wiki!.retrieved_at, kind: "version" };
      if (forum?.stale || !forum) fact.flags = ["version data may be out of date (GGG's forum could not be read just now)"];
    }
    return { current, announced, fact, installed, known, threads, notes };
  }

  /** Release date of the x.y.0 patch of a version's league, when known. */
  static majorRelease(info: VersionInfo, version: string): string | undefined {
    const major = majorOf(version);
    return info.known.filter((v) => majorOf(v.version) === major && v.released).sort((a, b) => compareVersions(a.version, b.version))[0]?.released;
  }

  /** The version that was live on a date (ISO), from a dated version list. */
  static at(known: GameVersion[], iso: string | undefined): string | undefined {
    if (!iso) return undefined;
    const day = iso.slice(0, 10);
    return known.filter((v) => v.released && v.released <= day).sort((a, b) => (a.released! < b.released! ? 1 : a.released! > b.released! ? -1 : compareVersions(b.version, a.version)))[0]?.version;
  }
}
