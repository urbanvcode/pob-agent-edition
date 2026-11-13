/** Builds the MCP server: tool list, tool calls, agent guide as instructions. */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AGENT_GUIDE } from "./guide.js";
import { VERSION } from "./paths.js";
import { Pob, ToolError } from "./pob.js";
import type { Context, Tool } from "./registry.js";
import { allTools } from "./tools/index.js";
import { TradeApiClient } from "./trade/client.js";

export function createTools(): { tools: Tool[]; context: Context } {
  const trade = new TradeApiClient({
    maxRequestsPerCall: parseInt(process.env.POE_TRADE_MAX_REQUESTS_PER_CALL || "16", 10) || 16,
  });
  const context: Context = { pob: new Pob(), trade };
  return { tools: allTools(trade), context };
}

/** What clients see in tools/list. */
export function toolDefinitions(tools: Tool[]) {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

export async function runTool(tools: Tool[], context: Context, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const found = tools.find((t) => t.name === name);
  if (!found) return { text: `Unknown tool "${name}". Tools: ${tools.map((t) => t.name).join(", ")}.`, isError: true };
  try {
    if (found.trade) context.trade.beginCall();
    return { text: await found.run(context, args ?? {}), isError: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // ToolError messages already say what to do next; anything else is unexpected.
    return { text: error instanceof ToolError ? message : `${name} failed: ${message}`, isError: true };
  }
}

export function createServer(): { server: Server; context: Context } {
  const { tools, context } = createTools();
  const server = new Server(
    { name: "pob-agent-edition", version: VERSION },
    { capabilities: { tools: {} }, instructions: AGENT_GUIDE },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions(tools) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { text, isError } = await runTool(tools, context, request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
  });
  return { server, context };
}
