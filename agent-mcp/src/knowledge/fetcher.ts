/**
 * Polite fetching for the knowledge engine.
 *
 * - identifies itself with the project's generic User-Agent (no personal data);
 * - obeys each site's robots.txt (a disallowed URL is never requested);
 * - one request at a time, with a pause between requests to the same site;
 * - caches every page on disk, so a question asked twice costs no request;
 * - a cap on requests per tool call, and no retry loops: when a site asks for a
 *   pause (429 / 503) it is left alone until then;
 * - offline mode (POB_KB_OFFLINE=1): cache only.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { cacheDir, USER_AGENT } from "../paths.js";
import { KbError } from "./types.js";

export interface RawResponse {
  status: number;
  body: string;
  retryAfter?: string | null;
}
export type RawFetch = (url: string) => Promise<RawResponse>;

export interface Page {
  url: string;
  body: string;
  /** ISO date-time the body was downloaded. */
  retrieved_at: string;
  fromCache: boolean;
  /** True when the cached copy is past its lifetime but the site could not be reached. */
  stale?: boolean;
}

interface CacheEntry {
  url: string;
  status: number;
  body: string;
  retrieved_at: string;
  /** An entry stored under another tag than the one asked for is refreshed (used for the game version). */
  tag?: string;
}

export interface GetOptions {
  /** Cache lifetime in milliseconds. */
  ttlMs: number;
  /** Refresh when the cached copy was stored under a different tag (e.g. an older game version). */
  tag?: string;
  /** Ignore the cache (still paced and capped). */
  refresh?: boolean;
  /** Treat 404 as "no such page" (returns null) instead of an error. */
  allow404?: boolean;
}

const HOUR = 3600_000;
export const TTL = { robots: 24 * HOUR, short: 6 * HOUR, day: 24 * HOUR, week: 7 * 24 * HOUR };

const defaultFetch: RawFetch = async (url) => {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/html;q=0.9, text/plain;q=0.8" },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  return { status: response.status, body: await response.text(), retryAfter: response.headers.get("retry-after") };
};

/** robots.txt: the rules that apply to us (the "*" group, or a group naming our client). */
export interface RobotsRules { allow: string[]; disallow: string[] }

export function parseRobots(text: string, agentToken = "pob-agent-edition"): RobotsRules {
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[] }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], allow: [], disallow: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && agentToken.includes(a)));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow) };
}

function robotsPattern(rule: string): RegExp {
  const anchored = rule.endsWith("$");
  const body = (anchored ? rule.slice(0, -1) : rule).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

/** Longest matching rule wins; Allow wins a tie (the standard robots.txt reading). */
export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best = -1, allowed = true;
  for (const rule of rules.disallow) if (rule.length > best && robotsPattern(rule).test(pathAndQuery)) { best = rule.length; allowed = false; }
  for (const rule of rules.allow) if (rule.length >= best && robotsPattern(rule).test(pathAndQuery)) { best = rule.length; allowed = true; }
  return allowed;
}

export interface FetcherOptions {
  fetch?: RawFetch;
  dir?: string;
  /** Pause between two requests to the same site. */
  minIntervalMs?: number;
  /** Requests allowed per tool call (cache hits are free). */
  maxRequestsPerCall?: number;
  offline?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class PoliteFetcher {
  private readonly raw: RawFetch;
  private readonly dir: string;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly offline: boolean;
  maxRequestsPerCall: number;
  private used = 0;
  /** Requests made since the process started (for tests and the evaluation report). */
  requests = 0;
  private readonly lastRequest = new Map<string, number>();
  private readonly pausedUntil = new Map<string, number>();
  private readonly robots = new Map<string, RobotsRules>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: FetcherOptions = {}) {
    this.raw = options.fetch ?? defaultFetch;
    this.dir = options.dir ?? cacheDir(path.join("knowledge", "http"));
    fs.mkdirSync(this.dir, { recursive: true });
    this.minIntervalMs = options.minIntervalMs ?? (Number(process.env.POB_KB_INTERVAL_MS) || 1500);
    this.maxRequestsPerCall = options.maxRequestsPerCall ?? (Number(process.env.POB_KB_MAX_REQUESTS) || 8);
    this.offline = options.offline ?? /^(1|true|on)$/i.test(process.env.POB_KB_OFFLINE ?? "");
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Start of a tool call: a fresh request budget. */
  beginCall(): void { this.used = 0; }

  private file(url: string): string {
    return path.join(this.dir, crypto.createHash("sha1").update(url).digest("hex") + ".json");
  }

  private read(url: string): CacheEntry | null {
    try { return JSON.parse(fs.readFileSync(this.file(url), "utf8")) as CacheEntry; } catch { return null; }
  }

  private write(entry: CacheEntry): void {
    try { fs.writeFileSync(this.file(entry.url), JSON.stringify(entry)); } catch { /* the cache is an optimisation */ }
  }

  /** One request at a time, paced per site. No retries. */
  private request(url: string, countsTowardsCall = true): Promise<RawResponse> {
    const run = async (): Promise<RawResponse> => {
      const host = new URL(url).host;
      const paused = this.pausedUntil.get(host) ?? 0;
      if (paused > this.now()) {
        throw new KbError(`${host} asked for a pause until ${new Date(paused).toISOString()}. Tell the player and use what is cached; do not retry before then.`);
      }
      if (countsTowardsCall) {
        if (this.used >= this.maxRequestsPerCall) throw new KbError(`Request limit for one question reached (${this.maxRequestsPerCall}). Ask a narrower question or call again.`);
        this.used++;
      }
      const wait = (this.lastRequest.get(host) ?? -Infinity) + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequest.set(host, this.now());
      this.requests++;
      const response = await this.raw(url);
      if (response.status === 429 || response.status === 503) {
        const seconds = Number(response.retryAfter);
        const pause = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 10 * 60_000;
        this.pausedUntil.set(host, this.now() + pause);
        throw new KbError(`${host} is asking for a pause (HTTP ${response.status}); leaving it alone for ${Math.round(pause / 1000)} s. Tell the player; do not retry in a loop.`);
      }
      return response;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async rulesFor(origin: string): Promise<RobotsRules> {
    const known = this.robots.get(origin);
    if (known) return known;
    const url = origin + "/robots.txt";
    const cached = this.read(url);
    let entry = cached;
    if (!cached || this.now() - Date.parse(cached.retrieved_at) > TTL.robots) {
      if (this.offline) {
        if (!cached) throw new KbError(`Offline and ${url} is not cached, so the site's rules are unknown.`);
      } else {
        try {
          const response = await this.request(url, false);
          // 5xx: the rules are unknown, so nothing is fetched from that site for now. 4xx: the site publishes no rules.
          if (response.status >= 500) throw new KbError(`${url} is failing (HTTP ${response.status}); not fetching from that site until its rules can be read.`);
          entry = { url, status: response.status, body: response.status === 200 ? response.body : "", retrieved_at: new Date(this.now()).toISOString() };
          this.write(entry);
        } catch (error) {
          if (!cached) throw error instanceof KbError ? error : new KbError(`Could not read ${url}: ${(error as Error).message}`);
        }
      }
    }
    const rules = parseRobots(entry?.body ?? "");
    this.robots.set(origin, rules);
    return rules;
  }

  /** Is this URL allowed by the site's robots.txt? */
  async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    return robotsAllows(await this.rulesFor(u.origin), u.pathname + u.search);
  }

  async get(url: string, options: GetOptions): Promise<Page | null> {
    const cached = this.read(url);
    const fresh = !!cached && this.now() - Date.parse(cached.retrieved_at) <= options.ttlMs && (options.tag === undefined || cached.tag === options.tag);
    const asPage = (entry: CacheEntry, stale = false): Page | null => {
      if (entry.status === 404) {
        if (options.allow404) return null;
        throw new KbError(`${url} does not exist (HTTP 404).`);
      }
      return { url, body: entry.body, retrieved_at: entry.retrieved_at, fromCache: true, ...(stale ? { stale: true } : {}) };
    };
    if (cached && (this.offline || (fresh && !options.refresh))) return asPage(cached, !fresh);
    if (this.offline) throw new KbError(`Offline mode (POB_KB_OFFLINE) and ${url} is not cached.`);
    if (!(await this.allowed(url))) throw new KbError(`${new URL(url).host} does not allow automated requests to this address (robots.txt); it was not fetched.`);
    let response: RawResponse;
    try {
      response = await this.request(url);
    } catch (error) {
      if (cached && cached.status !== 404) return asPage(cached, true);
      throw error instanceof KbError ? error : new KbError(`Could not reach ${new URL(url).host}: ${(error as Error).message}`);
    }
    if (response.status !== 200 && response.status !== 404) {
      if (cached && cached.status !== 404) return asPage(cached, true);
      throw new KbError(`${new URL(url).host} answered HTTP ${response.status} for ${url}.`);
    }
    const entry: CacheEntry = { url, status: response.status, body: response.status === 200 ? response.body : "", retrieved_at: new Date(this.now()).toISOString(), ...(options.tag !== undefined ? { tag: options.tag } : {}) };
    this.write(entry);
    const page = asPage(entry);
    return page ? { ...page, fromCache: false } : null;
  }
}
