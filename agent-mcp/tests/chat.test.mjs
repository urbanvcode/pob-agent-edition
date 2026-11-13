// Stage 10: AI chat bridge. No real backend, no network: fake CLIs and a fake Anthropic API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeParser, CodexParser } from "../build/chat/events.js";
import { EDIT_TOOLS, chatRules, claudeArgs, codexArgs, modelFor } from "../build/chat/backends.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(here, "..", "build", "chat", "bridge.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pob-chat-test-"));

function runBridge(request, env = {}, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BRIDGE, ...args], {
      env: { ...process.env, POB_AGENT_CACHE: path.join(tmp, "cache"), POB_AGENT_SETTINGS: path.join(tmp, "none.json"), ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => resolve(out.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))));
    child.stdin.end(request === undefined ? "" : JSON.stringify(request));
  });
}

test("Claude stream-json: streamed text, tools, session, no duplicate text", () => {
  const p = new ClaudeParser();
  const lines = [
    { type: "system", subtype: "init", session_id: "s-1" },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Checking " } } },
    { type: "assistant", message: { content: [{ type: "text", text: "Checking " }, { type: "tool_use", id: "t1", name: "mcp__pob__diagnose", input: {} }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }] } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Your chaos res is low." } } },
    { type: "result", is_error: false, result: "x", session_id: "s-1" },
  ];
  const ev = lines.flatMap((l) => p.feed(JSON.stringify(l)));
  assert.deepEqual(ev.filter((e) => e.t === "session"), [{ t: "session", id: "s-1" }]);
  assert.deepEqual(ev.filter((e) => e.t === "tool"), [{ t: "tool", name: "diagnose" }]);
  assert.deepEqual(ev.filter((e) => e.t === "tool_end"), [{ t: "tool_end", name: "diagnose", ok: true }]);
  assert.equal(ev.filter((e) => e.t === "text").map((e) => e.text).join(""), "Checking \n\nYour chaos res is low.");
  assert.ok(p.finished && !p.failed);
});

test("Claude not signed in is reported as not_signed_in", () => {
  const p = new ClaudeParser();
  p.feed(JSON.stringify({ type: "assistant", error: "authentication_failed", is_api_error_message: true, message: { content: [{ type: "text", text: "Not logged in · Please run /login" }] } }));
  p.feed(JSON.stringify({ type: "result", is_error: true, result: "Not logged in · Please run /login" }));
  assert.equal(p.failed?.code, "not_signed_in");
});

test("Codex exec --json: thread id, tool calls, messages", () => {
  const p = new CodexParser();
  const lines = [
    { type: "thread.started", thread_id: "th-9" },
    { type: "item.completed", item: { type: "agent_message", text: "Looking." } },
    { type: "item.started", item: { type: "mcp_tool_call", server: "pob", tool: "status" } },
    { type: "item.completed", item: { type: "mcp_tool_call", server: "pob", tool: "status", status: "failed", error: { message: "x" } } },
    { type: "item.completed", item: { type: "agent_message", text: "Done." } },
    { type: "turn.completed" },
  ];
  const ev = lines.flatMap((l) => p.feed(JSON.stringify(l)));
  assert.equal(p.session, "th-9");
  assert.deepEqual(ev.filter((e) => e.t === "tool_end"), [{ t: "tool_end", name: "status", ok: false }]);
  assert.equal(ev.filter((e) => e.t === "text").map((e) => e.text).join(""), "Looking.\n\nDone.");
  assert.ok(p.finished);
});

test("edit tools are off unless the panel allows them", () => {
  const off = claudeArgs({ backend: "claude", message: "hi" }, "m.json", "r.txt");
  const i = off.indexOf("--disallowedTools");
  assert.ok(i > 0);
  for (const t of EDIT_TOOLS) assert.ok(off[i + 1].includes(`mcp__pob__${t}`));
  assert.ok(off.includes("--strict-mcp-config") && off[off.indexOf("--tools") + 1] === "", "built-in tools off, only the pob server");
  assert.ok(!claudeArgs({ backend: "claude", message: "hi", allowEdits: true }, "m", "r").includes("--disallowedTools"));
  const cx = codexArgs({ backend: "codex", message: "hi", port: 31345 }).join(" ");
  assert.match(cx, /disabled_tools=\["edit_items"/);
  assert.match(cx, /--ignore-user-config/);
  assert.match(cx, /POB_AGENT_PORT="31345", POB_LIVE="only"/);
  assert.match(cx, /sandbox_mode="read-only"/);
  assert.ok(!codexArgs({ backend: "codex", message: "hi", allowEdits: true }).join(" ").includes("disabled_tools"));
  assert.match(codexArgs({ backend: "codex", message: "hi", session: "01a1d5ec-6b19-7d32" }).join(" "), /^exec resume 01a1d5ec-6b19-7d32 --json/);
  assert.match(cx, /-m gpt-6\.1-sol/, "Codex defaults to its mid-priced model");
  assert.match(cx, /model_reasoning_effort="low"/);
  assert.equal(off[off.indexOf("--model") + 1], "sonnet", "Claude Code defaults to Sonnet");
  assert.equal(claudeArgs({ backend: "claude", message: "hi", model: "haiku" }, "m", "r")[claudeArgs({ backend: "claude", message: "hi", model: "haiku" }, "m", "r").indexOf("--model") + 1], "haiku");
  assert.equal(modelFor({ backend: "codex", message: "x", model: "bad name; rm" }), "gpt-6.1-sol", "odd model text falls back to the default");
  assert.equal(modelFor({ backend: "api", message: "x" }), "claude-sonnet-5-5");
  assert.match(chatRules(false), /Edits are off/);
  assert.match(chatRules(true), /allowed edits/);
});

// Fake CLIs: print recorded-style output and echo what they were given.
function fakeCli(name, body) {
  const file = path.join(tmp, `${name}.mjs`);
  fs.writeFileSync(file, `let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const args=process.argv.slice(2);${body}});`);
  return file;
}

test("bridge runs a Codex CLI and streams normalised events", async () => {
  const exe = fakeCli("codex", `
    const out = (o) => console.log(JSON.stringify(o));
    out({type:"thread.started",thread_id:"th-1"});
    out({type:"item.started",item:{type:"mcp_tool_call",tool:"diagnose"}});
    out({type:"item.completed",item:{type:"mcp_tool_call",tool:"diagnose",status:"completed"}});
    out({type:"item.completed",item:{type:"agent_message",text:"edits:"+args.join(" ").includes("disabled_tools")+" ctx:"+s.includes("[PoB now]")+" q:"+s.includes("weak at bosses")}});
    out({type:"turn.completed"});`);
  const ev = await runBridge({ backend: "codex", message: "why am I weak at bosses?", context: "Build: test" }, { POB_CHAT_CODEX: exe });
  assert.deepEqual(ev.map((e) => e.t), ["start", "session", "tool", "tool_end", "text", "done"]);
  assert.equal(ev[4].text, "edits:true ctx:true q:true");
  assert.equal(ev[5].session, "th-1");
});

test("bridge runs a Claude Code CLI; a missing login becomes not_signed_in", async () => {
  const exe = fakeCli("claude", `
    const out = (o) => console.log(JSON.stringify(o));
    out({type:"system",subtype:"init",session_id:"c-1"});
    if (s.includes("login test")) { out({type:"result",is_error:true,result:"Not logged in · Please run /login",session_id:"c-1"}); return; }
    out({type:"stream_event",event:{type:"content_block_delta",delta:{type:"text_delta",text:"resume:"+args.includes("--resume")}}});
    out({type:"result",is_error:false,result:"",session_id:"c-1"});`);
  const ok = await runBridge({ backend: "claude", message: "hello", session: "c-0000000" }, { POB_CHAT_CLAUDE: exe });
  assert.equal(ok.find((e) => e.t === "text")?.text, "resume:true");
  assert.equal(ok.at(-1).session, "c-1");
  const bad = await runBridge({ backend: "claude", message: "login test" }, { POB_CHAT_CLAUDE: exe });
  assert.equal(bad.find((e) => e.t === "error")?.code, "not_signed_in");
});

test("bridge rejects empty requests and a missing API key", async () => {
  assert.equal((await runBridge(undefined))[0].code, "bad_request");
  const ev = await runBridge({ backend: "api", message: "hi" });
  assert.equal(ev.find((e) => e.t === "error")?.code, "no_key");
  const check = await runBridge(undefined, {}, ["--check"]);
  assert.equal(check[0].api.key, false);
  assert.ok("claude" in check[0] && "codex" in check[0]);
  assert.ok(!JSON.stringify(check[0]).includes(":\\\\") && !JSON.stringify(check[0]).includes("/Users/"), "no paths in --check");
});

// Fake Anthropic Messages API (SSE). Turn 1 calls the pob status tool, turn 2 answers.
function sse(events) {
  return events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`).join("");
}
function message(id, stop) {
  return { message: { id, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } };
}

test("API backend: streams text, routes tool use to the pob MCP server, keeps the key out of output", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      const json = JSON.parse(body);
      requests.push({ json, key: String(req.headers["authorization"] ?? "").replace(/^Bearer /, "") });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const toolTurn = !json.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
      if (toolTurn) {
        res.end(sse([
          ["message_start", message("m1")],
          ["content_block_start", { index: 0, content_block: { type: "tool_use", id: "tu1", name: "status", input: {} } }],
          ["content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }],
          ["content_block_stop", { index: 0 }],
          ["message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } }],
          ["message_stop", {}],
        ]));
      } else {
        res.end(sse([
          ["message_start", message("m2")],
          ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
          ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "PoB is " } }],
          ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "headless." } }],
          ["content_block_stop", { index: 0 }],
          ["message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }],
          ["message_stop", {}],
        ]));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const settings = path.join(tmp, "AgentEdition.json");
  const KEY = "sk-ant-test-0123456789abcdefghij";
  fs.writeFileSync(settings, JSON.stringify({ anthropicApiKey: KEY }));
  try {
    const env = { POB_AGENT_SETTINGS: settings, POB_CHAT_API_BASE: `http://127.0.0.1:${server.address().port}`, POB_LIVE: "off" };
    const ev = await runBridge({ backend: "api", message: "status?" }, env);
    const text = ev.filter((e) => e.t === "text").map((e) => e.text).join("");
    assert.equal(text, "PoB is headless.");
    assert.deepEqual(ev.filter((e) => e.t === "tool").map((e) => e.name), ["status"]);
    assert.equal(ev.find((e) => e.t === "tool_end")?.ok, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].key, KEY);
    const tools = requests[0].json.tools.map((t) => t.name);
    assert.ok(tools.includes("diagnose") && !tools.includes("edit_items") && !tools.includes("save_build"), "edit tools hidden by default");
    assert.equal(requests[0].json.model, "claude-sonnet-5-5", "the API backend defaults to Sonnet, not Opus");
    const toolResult = requests[1].json.messages.at(-1).content[0];
    assert.equal(toolResult.type, "tool_result");
    assert.match(toolResult.content, /headless|Mode/);
    assert.ok(!JSON.stringify(ev).includes(KEY), "the key never appears in the events");
    // The conversation continues from the saved history.
    const session = ev.at(-1).session;
    const ev2 = await runBridge({ backend: "api", message: "again", session }, env);
    assert.equal(ev2.at(-1).session, session);
    assert.ok(requests[2].json.messages.length >= 5);
  } finally {
    server.close();
  }
});

test("PoB's process runner (LuaJIT FFI) streams lines and kills the tree", { skip: process.platform !== "win32" }, () => {
  const root = path.resolve(here, "..", "..");
  const luajit = path.join(root, "luajit", "luajit.exe");
  if (!fs.existsSync(luajit)) return;
  const script = path.join(tmp, "proc.lua");
  fs.writeFileSync(script, `
package.path = ${JSON.stringify(path.join(root, "PathOfBuilding", "src").replace(/\\/g, "/") + "/?.lua;")} .. package.path
local P = require("Agent.ChatProcess")
local node = ${JSON.stringify(process.execPath.replace(/\\/g, "/"))}
local p = assert(P.start(P.quote(node) .. ' -e "process.stdin.on(\\'data\\',d=>process.stdout.write(\\'got:\\'+d))"', nil))
p:write("hello\\n") p:closeInput()
local lines, t0 = { }, os.clock()
while p.running and os.clock() - t0 < 15 do for _, l in ipairs(p:poll()) do lines[#lines + 1] = l end end
print("LINES", table.concat(lines, "|"), p.exitCode)
local q = assert(P.start(P.quote(node) .. ' -e "setTimeout(()=>{},60000)"', nil))
q:kill()
print("KILLED", tostring(q.running))
`);
  const r = spawnSync(luajit, [script], { encoding: "utf8", timeout: 30000 });
  assert.match(r.stdout, /LINES\tgot:hello\t0/);
  assert.match(r.stdout, /KILLED\tfalse/);
});
