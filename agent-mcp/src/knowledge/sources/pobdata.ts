/**
 * Path of Building's own data files (read from disk, no network): unique items
 * with their current mods, skill gems with tags and descriptions, and the
 * notables and keystones of the newest passive tree with their stats and the
 * oil recipe of the ones that can be anointed.
 *
 * PoB's data is exported from the game files by the PoB Community team, so it
 * ranks above poedb and the wiki, but it can lag a patch: every fact names the
 * PoB version and the game version PoB's newest passive tree is for.
 */
import fs from "fs";
import path from "path";
import { pobSrc } from "../../paths.js";

export interface PobUnique {
  name: string;
  base: string;
  /** Mod lines of the current variant. */
  mods: string[];
  /** League / Source / requirement lines PoB records. */
  info: string[];
  /** Names of older variants PoB knows ("Pre 3.19.0", ...). */
  oldVariants: string[];
  file: string;
}

export interface PobGem {
  name: string;
  tags: string;
  description?: string;
  castTime?: string;
  support: boolean;
  reqStr: number;
  reqDex: number;
  reqInt: number;
  maxLevel?: number;
  file: string;
}

export interface PobPassive {
  name: string;
  kind: "notable" | "keystone";
  stats: string[];
  /** Oil names of the anoint recipe ("Amber Oil", ...); empty when it cannot be anointed. */
  recipe: string[];
  /** Ascendancy or bloodline the node belongs to. */
  ascendancy?: string;
  /** Anoint-only notable: not on the tree, only from an anointment. */
  anointOnly: boolean;
  /** Listed without a place on the tree (e.g. granted by jewels). */
  offTree: boolean;
  file: string;
}

export interface PobVersion {
  /** PoB Community version, e.g. "2.67.2". */
  pob: string;
  /** Game version of PoB's newest passive tree, e.g. "3.30". */
  game: string;
}

const META = /^(Variant|Selected Variant|Selected Alt Variant|Has Alt Variant|Has Alt Variant Two|Has Alt Variant Three|Implicits|League|Source|LevelReq|Requires|Sockets|Upgrade|Unreleased|Limited to|Radius|Item Level|Quality|Talisman Tier|Crafted|Corrupted|Shaper Item|Elder Item)\b:?/;

/** One `[[ ... ]]` block of a Data/Uniques file -> the item with the mods of its current variant. */
export function parseUniqueBlock(block: string, file: string): PobUnique | null {
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const [name, base] = lines;
  const variants: string[] = [];
  for (const line of lines) { const v = /^Variant:\s*(.+)$/.exec(line); if (v) variants.push(v[1]); }
  // PoB lists variants oldest first and selects the last one for a new item.
  const current = variants.length;
  const mods: string[] = [], info: string[] = [];
  for (const line of lines.slice(2)) {
    if (/^(League|Source|LevelReq|Requires|Limited to|Radius):/.test(line)) { info.push(line.replace(/\{[^}]*\}/g, "")); continue; }
    if (META.test(line)) continue;
    let text = line, keep = true;
    for (let m: RegExpExecArray | null; (m = /^\{([^}]*)\}/.exec(text)); text = text.slice(m[0].length)) {
      const v = /^variant:([\d,]+)$/.exec(m[1]);
      if (v && variants.length && !v[1].split(",").includes(String(current))) keep = false;
    }
    if (keep && text) mods.push(text);
  }
  return { name, base, mods, info, oldVariants: variants.slice(0, -1), file };
}

/** One node block of a TreeData/<version>/tree.lua (its lines) -> a notable or keystone, else null. */
export function parsePassiveBlock(lines: string[], file: string): PobPassive | null {
  const fields = new Map<string, string | string[] | boolean>();
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\["(\w+)"\]\s*=\s*(.*?),?\s*$/.exec(lines[i]);
    if (!m) continue;
    const [, k, v] = m;
    if (v === "true") fields.set(k, true);
    else if (v.startsWith('"')) fields.set(k, luaLiteral(v));
    else if (v === "{") {
      // A list of strings; a line break inside a Lua string is a backslash at the end of the line.
      const items: string[] = [];
      let text = "";
      for (i++; i < lines.length && !/^\s*\},?\s*$/.test(lines[i]); i++) {
        text += lines[i].trim();
        if (text.endsWith("\\")) { text = text.slice(0, -1) + " "; continue; }
        if (/^".*",?$/.test(text)) items.push(luaLiteral(text.replace(/,$/, "")));
        text = "";
      }
      fields.set(k, items);
    } else fields.set(k, v);
  }
  const keystone = fields.get("isKeystone") === true;
  if (!keystone && fields.get("isNotable") !== true) return null;
  if (fields.get("isMastery") === true || fields.get("isProxy") === true) return null;
  const name = fields.get("name");
  if (typeof name !== "string" || !name) return null;
  const list = (k: string) => { const v = fields.get(k); return Array.isArray(v) ? v : []; };
  const ascendancy = fields.get("ascendancyName");
  const anointOnly = fields.get("isBlighted") === true;
  return {
    name,
    kind: keystone ? "keystone" : "notable",
    stats: list("stats"),
    recipe: list("recipe").map((oil) => oil.replace(/(?<=[a-z])Oil$/, " Oil")),
    ...(typeof ascendancy === "string" ? { ascendancy } : {}),
    anointOnly,
    offTree: !fields.has("group") && !anointOnly,
    file,
  };
}

function luaLiteral(text: string): string {
  return text.replace(/^"|"$/g, "").replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\s+/g, " ").trim();
}

/** Every notable and keystone in a tree.lua text. */
export function parsePassiveTree(text: string, file: string): PobPassive[] {
  const out: PobPassive[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const start = /^(\s*)\[\d+\]\s*=\s*\{\s*$/.exec(lines[i]);
    if (!start) continue;
    const end = new RegExp("^" + start[1] + "\\},?\\s*$");
    let j = i + 1;
    while (j < lines.length && !end.test(lines[j])) j++;
    const block = lines.slice(i + 1, j);
    if (block.some((l) => /^\s*\["skill"\]/.test(l))) {
      const passive = parsePassiveBlock(block, file);
      if (passive) out.push(passive);
    }
    i = j;
  }
  return out;
}

function luaString(text: string): string {
  return text.replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export class PobData {
  private uniqueIndex?: Map<string, PobUnique[]>;
  private gemIndex?: Map<string, PobGem>;
  private versionInfo?: PobVersion | null;
  private passiveIndex?: Map<string, PobPassive[]>;

  constructor(private readonly src: string = pobSrc()) {}

  available(): boolean {
    return fs.existsSync(path.join(this.src, "Data", "Uniques"));
  }

  version(): PobVersion | null {
    if (this.versionInfo !== undefined) return this.versionInfo;
    try {
      const manifest = fs.readFileSync(path.join(this.src, "..", "manifest.xml"), "utf8");
      const pob = /<Version number="([^"]+)"/.exec(manifest)?.[1];
      const versions = fs.readFileSync(path.join(this.src, "GameVersions.lua"), "utf8");
      const list = /treeVersionList\s*=\s*\{([\s\S]*?)\}/.exec(versions)?.[1] ?? "";
      const nums = [...list.matchAll(/"(\d+)_(\d+)(?:_[a-z_]+)?"/g)].map((m) => [Number(m[1]), Number(m[2])]);
      nums.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const top = nums[nums.length - 1];
      this.versionInfo = pob && top ? { pob, game: `${top[0]}.${top[1]}` } : null;
    } catch { this.versionInfo = null; }
    return this.versionInfo;
  }

  /** Link to the file in the PoB Community repository at the version we ship. */
  url(file: string): string {
    const v = this.version();
    return `https://github.com/PathOfBuildingCommunity/PathOfBuilding/blob/${v ? "v" + v.pob : "master"}/src/${file}`;
  }

  private uniques(): Map<string, PobUnique[]> {
    if (this.uniqueIndex) return this.uniqueIndex;
    const index = new Map<string, PobUnique[]>();
    const root = path.join(this.src, "Data", "Uniques");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (e.name.endsWith(".lua")) files.push(path.join(dir, e.name));
      }
    };
    try { walk(root); } catch { /* no PoB data: empty index */ }
    for (const file of files) {
      let text: string;
      try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
      const rel = "Data/Uniques/" + path.relative(root, file).replace(/\\/g, "/");
      for (const m of text.matchAll(/\[\[\r?\n([\s\S]*?)\]\]/g)) {
        const unique = parseUniqueBlock(m[1], rel);
        if (!unique) continue;
        const key = unique.name.toLowerCase();
        index.set(key, [...(index.get(key) ?? []), unique]);
      }
    }
    return (this.uniqueIndex = index);
  }

  private gems(): Map<string, PobGem> {
    if (this.gemIndex) return this.gemIndex;
    const index = new Map<string, PobGem>();
    const byEffect = new Map<string, PobGem>();
    try {
      const text = fs.readFileSync(path.join(this.src, "Data", "Gems.lua"), "utf8");
      for (const block of text.split(/\n\t\["Metadata\//).slice(1)) {
        const str = (k: string) => new RegExp(`\\n\\t\\t${k} = "([^"]*)"`).exec(block)?.[1];
        const num = (k: string) => Number(new RegExp(`\\n\\t\\t${k} = (\\d+)`).exec(block)?.[1] ?? 0);
        const name = str("name");
        if (!name) continue;
        const support = /\n\t\t\tsupport = true/.test(block);
        const gem: PobGem = { name: support && !/support$/i.test(name) ? `${name} Support` : name, tags: str("tagString") ?? "", support, reqStr: num("reqStr"), reqDex: num("reqDex"), reqInt: num("reqInt"), maxLevel: num("naturalMaxLevel") || undefined, file: "Data/Gems.lua" };
        if (!index.has(gem.name.toLowerCase())) index.set(gem.name.toLowerCase(), gem);
        const effect = str("grantedEffectId");
        if (effect && !byEffect.has(effect)) byEffect.set(effect, gem);
      }
      const dir = path.join(this.src, "Data", "Skills");
      for (const file of fs.readdirSync(dir).filter((f) => /^(act|sup)_.*\.lua$/.test(f))) {
        let gem: PobGem | undefined;
        for (const line of fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/)) {
          const start = /^skills\["([^"]+)"\] = \{/.exec(line);
          if (start) { gem = byEffect.get(start[1]); if (gem) gem.file = `Data/Skills/${file}`; continue; }
          if (!gem) continue;
          const d = /^\tdescription = "((?:[^"\\]|\\.)*)"/.exec(line);
          if (d && !gem.description) gem.description = luaString(d[1]);
          const c = /^\tcastTime = ([\d.]+)/.exec(line);
          if (c && !gem.castTime) gem.castTime = c[1];
        }
      }
    } catch { /* no PoB data: empty index */ }
    return (this.gemIndex = index);
  }

  /** Folder of the newest normal (not Ruthless, not alternate) passive tree, e.g. "3_30". */
  private treeFolder(): string | undefined {
    try {
      const versions = fs.readFileSync(path.join(this.src, "GameVersions.lua"), "utf8");
      const list = /treeVersionList\s*=\s*\{([\s\S]*?)\}/.exec(versions)?.[1] ?? "";
      const plain = [...list.matchAll(/"(\d+)_(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
      plain.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const top = plain[plain.length - 1];
      return top ? `${top[0]}_${top[1]}` : undefined;
    } catch { return undefined; }
  }

  private passives(): Map<string, PobPassive[]> {
    if (this.passiveIndex) return this.passiveIndex;
    const index = new Map<string, PobPassive[]>();
    const folder = this.treeFolder();
    if (folder) {
      const rel = `TreeData/${folder}/tree.lua`;
      try {
        const text = fs.readFileSync(path.join(this.src, rel), "utf8");
        for (const passive of parsePassiveTree(text, rel)) {
          const key = passive.name.toLowerCase();
          index.set(key, [...(index.get(key) ?? []), passive]);
        }
      } catch { /* no tree data: empty index */ }
    }
    // The tree's own node first, ascendancy and off-tree copies after it.
    for (const list of index.values()) list.sort((a, b) => Number(!!a.ascendancy || a.offTree) - Number(!!b.ascendancy || b.offTree));
    return (this.passiveIndex = index);
  }

  /** Notables and keystones with exactly this name (the main tree's node first). */
  passive(name: string): PobPassive[] {
    return this.passives().get(name.trim().toLowerCase()) ?? [];
  }

  /** Uniques with exactly this name (several when a name has more than one base). */
  unique(name: string): PobUnique[] {
    return this.uniques().get(name.trim().toLowerCase()) ?? [];
  }

  gem(name: string): PobGem | undefined {
    const key = name.trim().toLowerCase();
    return this.gems().get(key) ?? this.gems().get(key + " support") ?? this.gems().get(key.replace(/ support$/, ""));
  }

  /** Unique, gem, notable and keystone names that appear as a whole phrase in a text (longest first). */
  namesIn(text: string): string[] {
    const hay = " " + text.toLowerCase().replace(/[^a-z0-9']+/g, " ") + " ";
    const hits: string[] = [];
    for (const index of [this.uniques(), this.gems(), this.passives()]) {
      for (const key of index.keys()) {
        if (key.length < 5) continue;
        if (hay.includes(" " + key.replace(/[^a-z0-9']+/g, " ") + " ")) hits.push(key);
      }
    }
    // "Reflexes" inside "Iron Reflexes" is not a second name.
    const sorted = [...new Set(hits)].sort((a, b) => b.length - a.length);
    const words = (n: string) => " " + n.replace(/[^a-z0-9']+/g, " ") + " ";
    return sorted.filter((n, i) => !sorted.slice(0, i).some((longer) => words(longer).includes(words(n))));
  }
}
