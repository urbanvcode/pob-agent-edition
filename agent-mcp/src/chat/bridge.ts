#!/usr/bin/env node
/**
 * PoB Agent Edition chat bridge (Stage 10). PoB's chat panel starts it:
 *   node build/chat/bridge.js            request JSON on stdin, events (JSON lines) on stdout
 *   node build/chat/bridge.js --check    which backends are available (no paths printed)
 *   node build/chat/bridge.js --login claude|codex   opens the CLI's own sign-in in a console window
 * It is not an MCP server and adds no tools: the backends use agent-mcp's tools.
 */
import { spawn, spawnSync } from "child_process";
import { cliEnv, hasApiKey, runApi, runClaude, runCodex, stopCurrent, type ChatRequest } from "./backends.js";
import type { ChatEvent } from "./events.js";
import { findCli, type CliName } from "./find.js";

function emit(e: ChatEvent): void {
  process.stdout.write(JSON.stringify(e) + "\n");
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let s = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => resolve(s));
  });
}

function signedIn(name: CliName, exe: string): boolean | undefined {
  const args = name === "claude" ? ["auth", "status"] : ["login", "status"];
  if (/\.(cmd|c?m?js)$/i.test(exe)) return undefined;
  try {
    const r = spawnSync(exe, args, { timeout: 15000, windowsHide: true, encoding: "utf8", env: cliEnv() });
    if (r.error || r.status === null) return undefined;
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    if (/not logged in|not signed in|logged out|no credentials/i.test(out)) return false;
    return r.status === 0;
  } catch { return undefined; }
}

function check(): void {
  const result: Record<string, unknown> = { api: { key: hasApiKey() } };
  for (const name of ["claude", "codex"] as CliName[]) {
    const f = findCli(name);
    result[name] = f ? { found: true, source: f.source, signedIn: signedIn(name, f.path) } : { found: false };
  }
  process.stdout.write(JSON.stringify(result) + "\n");
}

function login(name: CliName): void {
  const f = findCli(name);
  if (!f) { process.stdout.write(JSON.stringify({ ok: false, error: `${name} not found` }) + "\n"); return; }
  const args = name === "claude" ? ["auth", "login"] : ["login"];
  // Detached: Windows gives it its own console window, where the player signs in.
  const child = spawn(f.path, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  process.stdout.write(JSON.stringify({ ok: true }) + "\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--check") return check();
  if (argv[0] === "--login") return login(argv[1] === "codex" ? "codex" : "claude");

  let req: ChatRequest;
  try {
    req = JSON.parse(await readStdin());
  } catch {
    emit({ t: "error", code: "bad_request", text: "The chat request was not valid JSON." });
    return;
  }
  if (!req || typeof req.message !== "string" || !req.message.trim()) {
    emit({ t: "error", code: "bad_request", text: "Empty message." });
    return;
  }
  const backend = req.backend === "codex" || req.backend === "api" ? req.backend : "claude";
  emit({ t: "start", backend });
  let session: string | undefined;
  try {
    session = backend === "codex" ? await runCodex(req, emit) : backend === "api" ? await runApi(req, emit) : await runClaude(req, emit);
  } catch (err) {
    emit({ t: "error", code: "failed", text: String((err as Error)?.message ?? err).slice(0, 400) });
  }
  emit({ t: "done", session });
}

for (const sig of ["SIGTERM", "SIGINT", "SIGBREAK"] as const) process.on(sig, () => { stopCurrent(); process.exit(1); });
main().then(() => process.exit(0), () => process.exit(1));
