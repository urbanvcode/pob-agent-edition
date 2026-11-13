// The JSON-lines protocol and the live/headless split follow ianderse/pob-mcp (https://github.com/ianderse/pob-mcp, GPL-3.0): src/pobLuaBridge.ts and src/server/luaClientManager.ts.
// Licensed under the GNU General Public License v3.0; see LICENSE at the repository root.
/**
 * Connection to Path of Building.
 *
 * Live first: the PoB Agent Edition window listens on 127.0.0.1 (JSON lines).
 * When no window is open, a headless PoB (Agent/Headless.lua under LuaJIT)
 * answers the same requests for saved build files. Both run the handlers in
 * PathOfBuilding/src/Agent/Handlers/.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import { liveMode, livePort, luajitExe, pobSrc } from "./paths.js";

export type Reply = { ok: boolean; error?: string; [key: string]: any };

/** An error whose message is meant for the AI: says what happened and what to do next. */
export class ToolError extends Error {}

const TIMEOUT_MS = parseInt(process.env.POB_TIMEOUT_MS || "60000", 10);
/** Headless engines idle this long are shut down (each is a second PoB in memory); 0 keeps them. */
const IDLE_MS = Math.max(0, parseFloat(process.env.POB_AGENT_IDLE_MINUTES ?? "5") || 0) * 60_000;

abstract class Link {
  abstract readonly kind: "live" | "headless";
  protected buffer = "";
  private waiting: Array<{ resolve: (line: string) => void; reject: (e: Error) => void }> = [];
  private queue: Promise<unknown> = Promise.resolve();
  protected dead: Error | null = null;
  private busy = 0;
  private lastUsed = Date.now();
  /** Requests sent so far (lets the idle check see whether the link was used meanwhile). */
  served = 0;

  /** How long nothing was asked of this link (0 while a request runs). */
  idleFor(now = Date.now()): number {
    return this.busy > 0 ? 0 : now - this.lastUsed;
  }

  protected onData(chunk: string): void {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      const w = this.waiting.shift();
      if (w) w.resolve(line);
    }
  }

  protected fail(error: Error): void {
    if (!this.dead) this.dead = error;
    for (const w of this.waiting.splice(0)) w.reject(error);
  }

  protected readLine(timeoutMs: number): Promise<string> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: (line: string) => { clearTimeout(timer); resolve(line); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      };
      const timer = setTimeout(() => {
        // A late reply would be matched to the wrong request: give up on this link.
        this.fail(new Error(`PoB did not answer within ${Math.round(timeoutMs / 1000)}s`));
        this.close();
      }, timeoutMs);
      this.waiting.push(entry);
    });
  }

  protected abstract write(line: string): void;
  abstract close(): void;

  get alive(): boolean {
    return !this.dead;
  }

  /** One request, one reply; requests are serialised. Resolves with the raw reply (ok may be false). */
  request(action: string, params: Record<string, unknown> = {}, timeoutMs = TIMEOUT_MS): Promise<Reply> {
    const run = async (): Promise<Reply> => {
      if (this.dead) throw this.dead;
      this.write(JSON.stringify({ action, params }) + "\n");
      const line = await this.readLine(timeoutMs);
      try {
        return JSON.parse(line) as Reply;
      } catch {
        throw new Error(`PoB sent an unreadable reply to ${action}`);
      }
    };
    this.busy++;
    this.served++;
    this.lastUsed = Date.now();
    const done = () => { this.busy--; this.lastUsed = Date.now(); };
    const result = this.queue.then(run, run);
    result.then(done, done);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Like request, but a reply with ok=false becomes a ToolError. */
  async call(action: string, params: Record<string, unknown> = {}, timeoutMs = TIMEOUT_MS): Promise<Reply> {
    const reply = await this.request(action, params, timeoutMs);
    if (!reply.ok) throw new ToolError(friendly(reply.error || `${action} failed`));
    return reply;
  }
}

function friendly(message: string): string {
  if (/PoB is on the build list/.test(message)) return "PoB is showing its build list. Open a build first: list_builds, then open_build.";
  if (/build not initialized|not initialized/.test(message)) return "No build is loaded. Use list_builds, then open_build.";
  return message;
}

class LiveLink extends Link {
  readonly kind = "live" as const;
  private constructor(private readonly socket: net.Socket) {
    super();
  }

  static connect(port: number): Promise<LiveLink> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      const link = new LiveLink(socket);
      socket.setEncoding("utf8");
      socket.setNoDelay(true);
      const timer = setTimeout(() => { socket.destroy(); reject(new Error("no answer")); }, 3000);
      socket.once("error", (e) => { clearTimeout(timer); link.fail(e); reject(e); });
      socket.on("close", () => link.fail(new Error("The PoB window closed the connection (was PoB closed?).")));
      socket.on("data", (d) => link.onData(String(d)));
      socket.once("connect", async () => {
        try {
          const hello = JSON.parse(await link.readLine(3000)) as Reply;
          clearTimeout(timer);
          if (!hello.ready) throw new Error("unexpected greeting");
          resolve(link);
        } catch (e) {
          clearTimeout(timer);
          socket.destroy();
          reject(e as Error);
        }
      });
    });
  }

  protected write(line: string): void {
    this.socket.write(line);
  }

  close(): void {
    this.fail(new Error("connection closed"));
    this.socket.destroy();
  }
}

class HeadlessLink extends Link {
  readonly kind = "headless" as const;
  private stderrTail = "";
  private constructor(private readonly proc: ChildProcessWithoutNullStreams) {
    super();
  }

  static async start(): Promise<HeadlessLink> {
    const src = pobSrc();
    if (!fs.existsSync(path.join(src, "Agent", "Headless.lua"))) {
      throw new ToolError(`PoB Agent Edition not found at ${src} (Agent/Headless.lua is missing). Run Install.cmd again or set POB_PATH.`);
    }
    const runtime = path.join(path.dirname(src), "runtime");
    const env = {
      ...process.env,
      LUA_PATH: `${path.join(runtime, "lua", "?.lua")};${path.join(runtime, "lua", "?", "init.lua")};;`,
      LUA_CPATH: `${path.join(runtime, process.platform === "win32" ? "?.dll" : "?.so")};;`,
    };
    const proc = spawn(luajitExe(), ["Agent/Headless.lua"], { cwd: src, env, stdio: ["pipe", "pipe", "pipe"] });
    const link = new HeadlessLink(proc);
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (d) => link.onData(String(d)));
    proc.stderr.on("data", (d) => { link.stderrTail = (link.stderrTail + String(d)).slice(-1500); });
    proc.on("error", (e) => link.fail(new ToolError(`Could not start the headless PoB engine (${luajitExe()}): ${e.message}`)));
    proc.on("exit", (code) => link.fail(new ToolError(`The headless PoB engine stopped (exit ${code}). ${link.stderrTail.trim().split("\n").pop() ?? ""}`.trim())));
    const hello = JSON.parse(await link.readLine(TIMEOUT_MS)) as Reply;
    if (!hello.ready) {
      link.close();
      throw new ToolError(`The headless PoB engine did not start: ${hello.error ?? "unknown error"}`);
    }
    return link;
  }

  protected write(line: string): void {
    this.proc.stdin.write(line);
  }

  close(): void {
    this.fail(new Error("engine closed"));
    try { this.proc.stdin.end(); } catch { /* already gone */ }
    this.proc.kill();
  }
}

export interface LoadedBuild {
  name: string;
  file?: string;
}

/**
 * Picks the PoB to talk to for each call: the window if one is open (checked
 * every call, so opening or closing PoB mid-conversation just works), else
 * the headless engine.
 */
export class Pob {
  private live: LiveLink | null = null;
  private headless: HeadlessLink | null = null;
  private side: HeadlessLink | null = null;
  private starting: Promise<HeadlessLink> | null = null;
  /** The build loaded in the headless engine (the window knows its own). */
  headlessBuild: LoadedBuild | null = null;
  /** The headless build (with unsaved edits) while its engine is shut down for being idle. */
  private parked: string | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  private async tryLive(): Promise<LiveLink | null> {
    if (liveMode() === "off") return null;
    if (this.live?.alive) return this.live;
    this.live = null;
    try {
      this.live = await LiveLink.connect(livePort());
      return this.live;
    } catch {
      return null;
    }
  }

  /** The link for the player's build. With needBuild, headless must have a build loaded. */
  async link(needBuild = true): Promise<Link> {
    const live = await this.tryLive();
    if (live) return live;
    if (liveMode() === "only") throw new ToolError(`PoB Agent Edition is not running (port ${livePort()}). Ask the player to start it, then retry.`);
    if (needBuild && !this.headlessBuild) {
      throw new ToolError("PoB Agent Edition is not open and no build file is loaded. Either ask the player to start PoB Agent Edition, or use list_builds then open_build to analyse a saved build without the window.");
    }
    return this.headlessLink();
  }

  private async headlessLink(): Promise<HeadlessLink> {
    if (this.headless?.alive) return this.headless;
    if (this.headless) {
      // The engine died: its build is gone with it.
      this.headless = null;
      const lost = this.headlessBuild;
      this.headlessBuild = null;
      if (lost) throw new ToolError(`The headless PoB engine stopped and lost the build "${lost.name}". Use open_build to load it again.`);
    }
    if (!this.starting) {
      this.starting = (async () => {
        const link = await HeadlessLink.start();
        if (this.parked !== null && this.headlessBuild) {
          // Shut down while idle: bring the build back exactly as it was, unsaved edits included.
          const reply = await link.request("load_build_xml", { xml: this.parked, name: this.headlessBuild.name });
          if (!reply.ok) {
            link.close();
            const lost = this.headlessBuild;
            this.headlessBuild = null;
            this.parked = null;
            throw new ToolError(`The headless PoB engine could not reload "${lost.name}" after its idle pause (${reply.error ?? "error"}). Use open_build to load it again.`);
          }
        }
        this.parked = null;
        return link;
      })().finally(() => { this.starting = null; });
    }
    this.headless = await this.starting;
    this.armIdle();
    return this.headless;
  }

  /** A second headless engine for looking at other builds without touching the player's. */
  async sideLink(): Promise<Link> {
    if (this.side?.alive) return this.side;
    this.side = await HeadlessLink.start();
    this.armIdle();
    return this.side;
  }

  private armIdle(): void {
    if (!IDLE_MS || this.idleTimer) return;
    this.idleTimer = setInterval(() => { void this.closeIdle(); }, Math.max(1000, Math.min(IDLE_MS / 2, 60_000)));
    this.idleTimer.unref();
  }

  /** Shuts down headless engines nobody used for IDLE_MS. The player's headless build is parked as XML. */
  async closeIdle(now = Date.now(), idleMs = IDLE_MS): Promise<void> {
    if (this.side && (!this.side.alive || this.side.idleFor(now) >= idleMs)) {
      this.side.close();
      this.side = null;
    }
    const h = this.headless;
    if (h && h.alive && !this.starting && h.idleFor(now) >= idleMs) {
      let xml: string | null = null;
      if (this.headlessBuild) {
        const before = h.served;
        const reply = await h.request("export_build_xml").catch(() => null);
        if (!reply?.ok || typeof reply.xml !== "string") return; // keep it running rather than lose the build
        if (h.served !== before + 1 || this.headless !== h) return; // used meanwhile
        xml = reply.xml;
      }
      this.parked = xml;
      this.headless = null;
      h.close();
    }
    if (!this.headless && !this.side && this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Engines running now (for tests). */
  engines(): { headless: boolean; side: boolean; parked: boolean } {
    return { headless: !!this.headless?.alive, side: !!this.side?.alive, parked: this.parked !== null };
  }

  async isLive(): Promise<boolean> {
    return (await this.tryLive()) !== null;
  }

  close(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    this.live?.close();
    this.headless?.close();
    this.side?.close();
  }
}
