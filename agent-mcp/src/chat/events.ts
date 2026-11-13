/**
 * Chat bridge events (Stage 10). The bridge turns each backend's output into
 * one small JSON object per line that PoB's chat panel reads:
 *   {t:"start",backend} {t:"session",id} {t:"text",text} (a delta)
 *   {t:"tool",name} {t:"tool_end",name,ok} {t:"status",text}
 *   {t:"error",code,text} {t:"done",session}
 * Parsers are pure (line in, events out) so tests can feed recorded output.
 */

export type ChatEvent =
  | { t: "start"; backend: string }
  | { t: "session"; id: string }
  | { t: "text"; text: string }
  | { t: "tool"; name: string }
  | { t: "tool_end"; name: string; ok: boolean }
  | { t: "status"; text: string }
  | { t: "error"; code: string; text: string }
  | { t: "done"; session?: string };

/** pob tool names come as mcp__pob__x (Claude) or x (Codex): show x. */
export function shortTool(name: string): string {
  return String(name || "?").replace(/^mcp__pob__/, "");
}

function parse(line: string): any | undefined {
  const s = line.trim();
  if (!s.startsWith("{")) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}

/** Claude Code `-p --output-format stream-json --verbose --include-partial-messages`. */
export class ClaudeParser {
  session: string | undefined;
  private streamed = false; // text came as partial deltas: skip full assistant text blocks
  private wroteText = false;
  private needBreak = false;
  private tools = new Map<string, string>(); // tool_use id -> name
  finished = false;
  failed: ChatEvent | undefined;

  private text(s: string): ChatEvent[] {
    if (!s) return [];
    const prefix = this.needBreak && this.wroteText ? "\n\n" : "";
    this.needBreak = false;
    this.wroteText = true;
    return [{ t: "text", text: prefix + s }];
  }

  feed(line: string): ChatEvent[] {
    const m = parse(line);
    if (!m) return [];
    const out: ChatEvent[] = [];
    if (m.session_id && m.session_id !== this.session) {
      this.session = m.session_id;
      out.push({ t: "session", id: m.session_id });
    }
    if (m.type === "stream_event") {
      const e = m.event ?? {};
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
        this.streamed = true;
        out.push(...this.text(e.delta.text));
      }
    } else if (m.type === "assistant") {
      const content = Array.isArray(m.message?.content) ? m.message.content : [];
      if (m.error === "authentication_failed" || m.is_api_error_message) {
        const text = content.map((c: any) => c?.text ?? "").join(" ").trim();
        this.failed = classifyClaudeError(text || String(m.error));
        return out;
      }
      for (const c of content) {
        if (c?.type === "text" && !this.streamed) out.push(...this.text(c.text));
        if (c?.type === "tool_use") {
          this.tools.set(c.id, c.name);
          this.needBreak = true;
          out.push({ t: "tool", name: shortTool(c.name) });
        }
      }
    } else if (m.type === "user") {
      const content = Array.isArray(m.message?.content) ? m.message.content : [];
      for (const c of content) {
        if (c?.type === "tool_result") out.push({ t: "tool_end", name: shortTool(this.tools.get(c.tool_use_id) ?? "?"), ok: !c.is_error });
      }
    } else if (m.type === "result") {
      this.finished = true;
      if (m.is_error && !this.failed) this.failed = classifyClaudeError(String(m.result ?? m.subtype ?? "error"));
      if (!this.wroteText && !m.is_error && typeof m.result === "string") out.push(...this.text(m.result));
    }
    return out;
  }
}

export function classifyClaudeError(text: string): ChatEvent {
  if (/not logged in|\/login|authentication_failed|invalid api key|oauth/i.test(text)) {
    return { t: "error", code: "not_signed_in", text: "Claude Code is not signed in. Click 'Sign in' next to the backend in Options (it runs: claude auth login), then ask again." };
  }
  if (/usage limit|rate limit|quota|overloaded/i.test(text)) return { t: "error", code: "limit", text: `Claude Code: ${text}` };
  return { t: "error", code: "failed", text: `Claude Code: ${text}` };
}

/** Codex `exec --json` (JSONL thread events). Codex sends whole messages, not deltas. */
export class CodexParser {
  session: string | undefined;
  private wroteText = false;
  finished = false;
  failed: ChatEvent | undefined;

  feed(line: string): ChatEvent[] {
    const m = parse(line);
    if (!m) return [];
    const out: ChatEvent[] = [];
    const item = m.item ?? {};
    switch (m.type) {
      case "thread.started":
        if (m.thread_id) { this.session = m.thread_id; out.push({ t: "session", id: m.thread_id }); }
        break;
      case "item.started":
        if (item.type === "mcp_tool_call") out.push({ t: "tool", name: shortTool(item.tool) });
        break;
      case "item.completed":
        if (item.type === "mcp_tool_call") out.push({ t: "tool_end", name: shortTool(item.tool), ok: item.status === "completed" && !item.error });
        else if (item.type === "agent_message" && item.text) {
          out.push({ t: "text", text: (this.wroteText ? "\n\n" : "") + String(item.text).trim() });
          this.wroteText = true;
        } else if (item.type === "error" && item.message) out.push({ t: "status", text: String(item.message) });
        break;
      case "turn.completed":
        this.finished = true;
        break;
      case "turn.failed":
        this.finished = true;
        this.failed = classifyCodexError(String(m.error?.message ?? "the turn failed"));
        break;
      case "error":
        this.failed = classifyCodexError(String(m.message ?? "error"));
        break;
    }
    return out;
  }
}

export function classifyCodexError(text: string): ChatEvent {
  if (/not logged in|login|unauthori[sz]ed|401|auth/i.test(text)) {
    return { t: "error", code: "not_signed_in", text: "Codex is not signed in. Click 'Sign in' next to the backend in Options (it runs: codex login), then ask again." };
  }
  if (/usage limit|rate limit|quota/i.test(text)) return { t: "error", code: "limit", text: `Codex: ${text}` };
  return { t: "error", code: "failed", text: `Codex: ${text}` };
}
