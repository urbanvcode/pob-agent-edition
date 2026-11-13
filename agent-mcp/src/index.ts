#!/usr/bin/env node
/**
 * PoB Agent Edition MCP server (stdio).
 *
 * Talks to the PoB Agent Edition window on 127.0.0.1 when it is open, and to a
 * headless PoB otherwise. stdout carries the MCP protocol; logs go to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const { server, context } = createServer();

const shutdown = () => {
  context.pob.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
console.error("[pob-agent-edition] MCP server ready");
