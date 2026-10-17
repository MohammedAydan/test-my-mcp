#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerTools } from "./tools.js";
import { ENGINE_URL } from "./engine-client.js";

/**
 * MCP stdio entrypoint (`npm run start -w @motionforge/mcp-server`).
 * All diagnostics go to stderr — stdout is the protocol channel.
 */
const server = new McpServer({ name: "motionforge", version: "0.1.0" });
registerTools(server);

console.error(`[motionforge-mcp] core-engine: ${ENGINE_URL}`);
const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = () => void server.close();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
