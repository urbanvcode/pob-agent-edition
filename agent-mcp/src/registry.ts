/** Tool registry: every tool is a name, a short description, a JSON schema and a handler returning text. */
import { ToolError, type Pob } from "./pob.js";
import type { TradeApiClient } from "./trade/client.js";

export interface Context {
  pob: Pob;
  trade: TradeApiClient;
  /** Old tool names that still work (hidden from the tool list). */
  aliases?: Map<string, Tool>;
}

export type Args = Record<string, any>;

export interface Tool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Trade tools get a fresh per-question request budget. */
  trade?: boolean;
  /** True when this call changes, opens or saves a build (refused in a read-only chat: POB_READ_ONLY=1). */
  writes?: (args: Args) => boolean;
  run(ctx: Context, args: Args): Promise<string>;
}

export const READ_ONLY_REFUSAL = "Edits are off in this chat: this would change, open or save a build. Offer an apply line instead; the player can switch on 'AI may edit' in the panel.";

/** Runs a tool, refusing writes when the server was started read-only (the PoB chat panel with edits off). */
export function runChecked(t: Tool, ctx: Context, args: Args): Promise<string> {
  if (process.env.POB_READ_ONLY === "1" && t.writes?.(args)) return Promise.reject(new ToolError(READ_ONLY_REFUSAL));
  return t.run(ctx, args);
}

/** A public tool that routes each call to one internal tool (merged tools: one name, several modes). */
export function routed(name: string, description: string, properties: Record<string, unknown>, required: string[],
  pick: (args: Args) => [Tool, Args], extra: Partial<Tool> = {}): Tool {
  return tool(name, description, properties, required, (ctx, args) => { const [t, a] = pick(args); return runChecked(t, ctx, a); }, extra);
}

export const S = {
  str: (description?: string) => (description ? { type: "string", description } : { type: "string" }),
  num: (description?: string) => (description ? { type: "number", description } : { type: "number" }),
  bool: (description?: string) => (description ? { type: "boolean", description } : { type: "boolean" }),
  enum: (values: string[], description?: string) => (description ? { type: "string", enum: values, description } : { type: "string", enum: values }),
  list: (items: unknown, description?: string) => (description ? { type: "array", items, description } : { type: "array", items }),
  obj: (description?: string) => (description ? { type: "object", description } : { type: "object" }),
};

export function tool(name: string, description: string, properties: Record<string, unknown>, required: string[], run: Tool["run"], extra: Partial<Tool> = {}): Tool {
  return { name, description, inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) }, run, ...extra };
}
