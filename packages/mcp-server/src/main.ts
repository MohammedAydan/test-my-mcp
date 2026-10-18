#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAuthoringResource, registerTools } from "./tools.js";
import { ENGINE_URL } from "./engine-client.js";

/**
 * MCP stdio entrypoint (`npm run start -w @motionforge/mcp-server`).
 * All diagnostics go to stderr — stdout is the protocol channel.
 */

/**
 * Never let a broken pipe kill the daemon.
 *
 * stdio is a PIPE with a bounded buffer. A tool result that exceeds it makes
 * the client close its end, and the next write to stdout raises `EPIPE` — an
 * *unhandled* error event, which terminates the process. That is how a
 * 12-frame inspection used to take the whole MCP server down.
 *
 * The handler swallows EPIPE (there is no one left to write to) and lets every
 * other error surface, because a silent failure mode is worse than a crash.
 */
function hardenStream(stream: NodeJS.WriteStream | NodeJS.ReadStream, name: string): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED") {
      console.error(`[motionforge-mcp] ${name} closed by the peer (${error.code}) — shutting down cleanly`);
      process.exit(0);
    }
    console.error(`[motionforge-mcp] ${name} error: ${error.message}`);
  });
}

hardenStream(process.stdout, "stdout");
hardenStream(process.stderr, "stderr");
hardenStream(process.stdin, "stdin");

const server = new McpServer({ name: "motionforge", version: "0.1.0" });
registerTools(server);
registerAuthoringResource(server);

console.error(`[motionforge-mcp] core-engine: ${ENGINE_URL}`);
const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = () => void server.close();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);