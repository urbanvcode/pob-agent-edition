/** Tool registry: every tool is a name, a short description, a JSON schema and a handler returning text. */
import type { Pob } from "./pob.js";
import type { TradeApiClient } from "./trade/client.js";

export interface Context {
  pob: Pob;
  trade: TradeApiClient;
}

export type Args = Record<string, any>;

export interface Tool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Trade tools get a fresh per-question request budget. */
  trade?: boolean;
  run(ctx: Context, args: Args): Promise<string>;
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
