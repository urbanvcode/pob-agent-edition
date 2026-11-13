/**
 * Chat backends (Stage 10): Claude Code CLI, Codex CLI and the optional
 * Anthropic API key. Every backend drives the same agent-mcp server (the
 * pob tools), started for this chat only and pinned to the PoB window that
 * asked (POB_AGENT_PORT, POB_LIVE=only), so it can never act on another
 * build. Built-in tools that run commands, read or write files are off.
 */
import { spawn, type ChildProcess } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { cacheDir, settingsCandidates } from "../paths.js";
import { ClaudeParser, CodexParser, type ChatEvent } from "./events.js";
import { findCli } from "./find.js";

export type Backend = "claude" | "codex" | "api";

export interface ChatRequest {
  backend: Backend;
  message: string;
  /** Build, profile, guide and view, written by PoB (Agent/Chat.lua). */
  context?: string;
  /** Backend session / thread id to continue. */
  session?: string;
  /** The panel's "AI may edit" toggle. Off: only reading and simulating tools. */
  allowEdits?: boolean;
  /** Port of the PoB window's live API. Absent: headless (tests). */
  port?: number;
  model?: string;
}

export type Emit = (e: ChatEvent) => void;

/** Tools that change the open build, load or save builds. Off unless the panel allows edits. */
export const EDIT_TOOLS = ["edit_items", "edit_skills", "edit_tree", "set_config", "atlas_edit", "save_build", "open_build", "restore", "guide_import", "character_sync"];

export function chatRules(allowEdits: boolean): string {
  return [
    "You are the AI chat panel inside PoB Agent Edition (Path of Building for Path of Exile 1). The player reads your reply in a narrow side panel: keep it short and plain. Use short paragraphs, '-' lists and **bold**; no tables, no code blocks, no images.",
    "Work on the build open in the PoB window with the pob tools (profile_get once, then diagnose / stats / what_if). Numbers come from PoB, game facts from kb_lookup. Follow the pob server's rules.",
    "Links: write [[node:Exact Node Name]], [[item:Exact Item Name]] and [[gem:Exact Gem Name]] for things in this build or tree. The panel makes them clickable: they highlight in PoB.",
    'Suggested changes: put each on its own line as [[apply:Short label|{"ops":[...]}]] with the same ops edit_items / edit_skills / edit_tree / what_if take, JSON on one line (node ids from tree_search, slots from build_summary). Check it with what_if first. The player clicks Preview (PoB simulates it) and then Apply.',
    allowEdits
      ? "The player allowed edits in this chat: when they ask you to change something you may use the edit tools; changes stay in the window and are never saved over their build file (save_build only with a new name)."
      : "Edits are off in this chat: you cannot change, open or save builds. Offer apply lines instead, and say the player can switch on 'AI may edit' in the panel.",
    "Never touch the game client. Trade is instant buyout only; the player clicks buy. Never ask for passwords, POESESSID or API keys.",
  ].join("\n");
}

export function withContext(req: ChatRequest): string {
  const ctx = (req.context ?? "").trim();
  return ctx ? `[PoB now]\n${ctx}\n[/PoB now]\n\n${req.message}` : req.message;
}

// --- settings (AgentEdition.json) -------------------------------------------------

interface ChatSettings { claudePath?: string; codexPath?: string; apiModel?: string }
function settings(): { chat: ChatSettings; apiKey?: string } {
  for (const file of settingsCandidates()) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const key = typeof data.anthropicApiKey === "string" && /^[\w-]{20,}$/.test(data.anthropicApiKey) ? data.anthropicApiKey : undefined;
      return { chat: typeof data.chat === "object" && data.chat ? data.chat : {}, apiKey: key };
    } catch { /* next */ }
  }
  return { chat: {} };
}
export function hasApiKey(): boolean { return !!settings().apiKey; }

// --- the pob MCP server for this chat --------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, "..", "index.js");

export function serverEnv(req: ChatRequest): Record<string, string> {
  const env: Record<string, string> = {};
  if (req.port) { env.POB_AGENT_PORT = String(req.port); env.POB_LIVE = "only"; }
  return env;
}

// --- running a CLI ---------------------------------------------------------------

/** npm's .cmd shims cannot be spawned without a shell: run the script they point at with node. */
function command(exe: string, args: string[]): { cmd: string; args: string[] } {
  if (/\.(c?m?js)$/i.test(exe)) return { cmd: process.execPath, args: [exe, ...args] };
  if (/\.cmd$/i.test(exe)) {
    const text = fs.readFileSync(exe, "utf8");
    const m = text.match(/%(?:~?dp0)%\\([^"\s]+\.(?:c?m?js))/i);
    if (m) return { cmd: process.execPath, args: [path.join(path.dirname(exe), m[1]), ...args] };
  }
  return { cmd: exe, args };
}

/** The CLIs get the player's environment minus anything that would swap their own login for another one. */
export function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE$|CLAUDE_AGENT_SDK|OPENAI_API_KEY$|CODEX_THREAD)/i.test(k)) continue;
    env[k] = v;
  }
  return env;
}

let current: ChildProcess | undefined;
export function stopCurrent(): void { try { current?.kill(); } catch { /* gone */ } }

function runCli(exe: string, args: string[], stdin: string, cwd: string, onLine: (l: string) => void): Promise<{ code: number | null; stderr: string }> {
  const c = command(exe, args);
  return new Promise((resolve) => {
    const child = spawn(c.cmd, c.args, { cwd, env: cliEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    current = child;
    let buf = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => { if (stderr.length < 20000) stderr += d; });
    child.on("error", (err) => { stderr += String(err.message); });
    child.on("close", (code) => { if (buf.trim()) onLine(buf); current = undefined; resolve({ code, stderr }); });
    child.stdin.on("error", () => { /* closed early */ });
    child.stdin.end(stdin, "utf8");
  });
}

function workDir(): string {
  // Outside any project, so no CLAUDE.md / AGENTS.md of another folder joins the chat.
  return cacheDir(path.join("chat", "work"));
}

function lastLine(s: string): string {
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join(" ").slice(0, 400);
}

// --- Claude Code ------------------------------------------------------------------

export function claudeArgs(req: ChatRequest, mcpFile: string, rulesFile: string): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--mcp-config", mcpFile, "--strict-mcp-config", "--tools", "", "--allowedTools", "mcp__pob",
    "--permission-mode", "dontAsk", "--append-system-prompt-file", rulesFile];
  if (!req.allowEdits) args.push("--disallowedTools", EDIT_TOOLS.map((t) => `mcp__pob__${t}`).join(","));
  if (req.session && /^[\w-]{8,80}$/.test(req.session)) args.push("--resume", req.session);
  if (req.model) args.push("--model", req.model);
  return args;
}

export async function runClaude(req: ChatRequest, emit: Emit): Promise<string | undefined> {
  const found = findCli("claude", settings().chat.claudePath);
  if (!found) { emit({ t: "error", code: "not_found", text: "Claude Code was not found. Install it (claude.com/claude-code) or the Claude desktop app, or choose another backend in Options." }); return; }
  const dir = cacheDir("chat");
  const mcpFile = path.join(dir, `mcp-${req.port ?? "headless"}.json`);
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { pob: { command: process.execPath, args: [SERVER], env: serverEnv(req) } } }, null, 1));
  const rulesFile = path.join(dir, `rules-${req.allowEdits ? "edit" : "read"}.txt`);
  fs.writeFileSync(rulesFile, chatRules(!!req.allowEdits));
  const parser = new ClaudeParser();
  const res = await runCli(found.path, claudeArgs(req, mcpFile, rulesFile), withContext(req), workDir(), (l) => parser.feed(l).forEach(emit));
  if (parser.failed) emit(parser.failed);
  else if (!parser.finished) emit({ t: "error", code: "failed", text: `Claude Code stopped (${res.code ?? "cancelled"})${res.stderr ? `: ${lastLine(res.stderr)}` : ""}` });
  return parser.session;
}

// --- Codex ------------------------------------------------------------------------

const toml = (v: unknown) => JSON.stringify(v);

export function codexArgs(req: ChatRequest): string[] {
  const env = Object.entries(serverEnv(req)).map(([k, v]) => `${k}=${toml(v)}`).join(", ");
  const cfg = [
    `mcp_servers.pob.command=${toml(process.execPath)}`,
    `mcp_servers.pob.args=${toml([SERVER])}`,
    `mcp_servers.pob.env={${env}}`,
    `mcp_servers.pob.default_tools_approval_mode="approve"`,
    `mcp_servers.pob.startup_timeout_sec=30`,
    `approval_policy="never"`,
    `sandbox_mode="read-only"`,
  ];
  if (!req.allowEdits) cfg.push(`mcp_servers.pob.disabled_tools=${toml(EDIT_TOOLS)}`);
  const resume = req.session && /^[\w-]{8,80}$/.test(req.session);
  const args = ["exec", ...(resume ? ["resume", req.session as string] : []), "--json", "--skip-git-repo-check", "--ignore-user-config"];
  for (const c of cfg) args.push("-c", c);
  if (req.model) args.push("-m", req.model);
  args.push("-");
  return args;
}

export async function runCodex(req: ChatRequest, emit: Emit): Promise<string | undefined> {
  const found = findCli("codex", settings().chat.codexPath);
  if (!found) { emit({ t: "error", code: "not_found", text: "Codex was not found. Install the Codex CLI or desktop app, or choose another backend in Options." }); return; }
  const parser = new CodexParser();
  // Codex has no system-prompt flag: the rules ride along with each message.
  const prompt = `${chatRules(!!req.allowEdits)}\n\n${withContext(req)}`;
  const res = await runCli(found.path, codexArgs(req), prompt, workDir(), (l) => parser.feed(l).forEach(emit));
  if (parser.failed) emit(parser.failed);
  else if (!parser.finished) {
    const err = lastLine(res.stderr);
    emit(/login|auth|401/i.test(err)
      ? { t: "error", code: "not_signed_in", text: "Codex is not signed in. Click 'Sign in' next to the backend in Options (it runs: codex login), then ask again." }
      : { t: "error", code: "failed", text: `Codex stopped (${res.code ?? "cancelled"})${err ? `: ${err}` : ""}` });
  }
  return parser.session;
}

// --- Anthropic API key --------------------------------------------------------------

const API_MAX_MESSAGES = 80;

export async function runApi(req: ChatRequest, emit: Emit): Promise<string | undefined> {
  const { chat, apiKey } = settings();
  if (!apiKey) { emit({ t: "error", code: "no_key", text: "No Anthropic API key is stored. Add one in Options > AI chat, or choose another backend." }); return; }
  const [{ default: Anthropic }, { Client }, { StdioClientTransport }] = await Promise.all([
    import("@anthropic-ai/sdk"),
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);

  const histDir = cacheDir(path.join("chat", "api"));
  let session = req.session && /^[\w-]{8,80}$/.test(req.session) ? req.session : undefined;
  let messages: any[] = [];
  if (session) {
    try { messages = JSON.parse(fs.readFileSync(path.join(histDir, `${session}.json`), "utf8")); } catch { messages = []; }
  }
  if (!session || messages.length > API_MAX_MESSAGES) {
    if (session) emit({ t: "status", text: "The conversation got long: starting a fresh one." });
    session = crypto.randomUUID();
    messages = [];
  }
  emit({ t: "session", id: session });

  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...(process.env as Record<string, string>), ...serverEnv(req) }, stderr: "ignore" });
  const mcp = new Client({ name: "pob-agent-chat", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const listed = await mcp.listTools();
    const tools = listed.tools
      .filter((t) => req.allowEdits || !EDIT_TOOLS.includes(t.name))
      .map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema as any }));
    const system = [mcp.getInstructions() ?? "", chatRules(!!req.allowEdits)].filter(Boolean).join("\n\n");
    const client = new Anthropic({ apiKey, authToken: null, ...(process.env.POB_CHAT_API_BASE ? { baseURL: process.env.POB_CHAT_API_BASE } : {}), maxRetries: 2 });
    messages.push({ role: "user", content: withContext(req) });
    let wrote = false;
    for (let turn = 0; turn < 25; turn++) {
      const stream = client.beta.messages.stream({
        model: req.model || chat.apiModel || "claude-opus-5-5",
        max_tokens: 64000,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        tools,
        messages,
      } as any);
      let first = true;
      stream.on("text", (t: string) => {
        emit({ t: "text", text: (first && wrote ? "\n\n" : "") + t });
        first = false;
        wrote = true;
      });
      const msg: any = await stream.finalMessage();
      messages.push({ role: "assistant", content: msg.content });
      if (msg.stop_reason === "refusal") { emit({ t: "error", code: "refusal", text: "The model declined this request." }); break; }
      if (msg.stop_reason === "pause_turn") continue;
      if (msg.stop_reason !== "tool_use") break;
      const results: any[] = [];
      for (const block of msg.content.filter((b: any) => b.type === "tool_use")) {
        emit({ t: "tool", name: block.name });
        let text: string, isError = false;
        try {
          const r: any = await mcp.callTool({ name: block.name, arguments: block.input ?? {} });
          text = (Array.isArray(r.content) ? r.content : []).map((c: any) => (c.type === "text" ? c.text : "")).join("\n") || "(no output)";
          isError = !!r.isError;
        } catch (err) {
          text = String((err as Error).message ?? err);
          isError = true;
        }
        emit({ t: "tool_end", name: block.name, ok: !isError });
        results.push({ type: "tool_result", tool_use_id: block.id, content: text, ...(isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err: any) {
    const status = err?.status;
    emit({ t: "error", code: status === 401 ? "no_key" : "failed", text: status === 401 ? "The Anthropic API key was refused (401). Check it in Options > AI chat." : `Anthropic API: ${String(err?.message ?? err).slice(0, 300)}` });
  } finally {
    // A turn cut off after a tool call would leave tool_use blocks without results: drop it.
    const has = (m: any, type: string) => Array.isArray(m?.content) && m.content.some((b: any) => b.type === type);
    while (messages.length) {
      const last = messages[messages.length - 1];
      if ((last.role === "user" && has(last, "tool_result")) || (last.role === "assistant" && has(last, "tool_use"))) messages.pop();
      else break;
    }
    fs.writeFileSync(path.join(histDir, `${session}.json`), JSON.stringify(messages));
    await mcp.close().catch(() => undefined);
  }
  return session;
}
