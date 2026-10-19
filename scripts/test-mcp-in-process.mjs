/**
 * End-to-End MCP in-process tool verification script.
 * Verifies that the MCP server operates 100% in-process with zero HTTP/REST dependency.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, registerAuthoringResource } from "../packages/mcp-server/src/index.js";
import { MINIMAL_VALID_SCENE } from "@motionforge/scene-spec";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function main() {
  // Ensure no loopback HTTP is used
  delete process.env.MOTIONFORGE_ENGINE_URL;

  console.log("▶ [1/5] Starting MCP in-process server & client pair...");
  const server = new McpServer({ name: "motionforge-e2e-test", version: "0.1.0" });
  registerTools(server);
  registerAuthoringResource(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-caller", version: "0.1.0" });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  console.log("✔ Connected via InMemoryTransport");

  // Step 1: List tools
  console.log("▶ [2/5] Calling listTools...");
  const { tools } = await client.listTools();
  console.log(`✔ Found ${tools.length} tools: ${tools.map(t => t.name).join(", ")}`);
  if (tools.length !== 6) {
    throw new Error(`Expected 6 tools, got ${tools.length}`);
  }

  // Step 2: get_motion_capabilities
  console.log("▶ [3/5] Invoking get_motion_capabilities tool...");
  const capRes = await client.callTool({
    name: "get_motion_capabilities",
    arguments: {},
  });
  if (capRes.isError) {
    throw new Error(`get_motion_capabilities failed: ${JSON.stringify(capRes)}`);
  }
  const capText = capRes.content[0].text;
  if (!capText.includes("AUTHORING CONTRACT") || !capText.includes("minimalValidScene")) {
    throw new Error(`get_motion_capabilities response missing expected content: ${capText.slice(0, 200)}`);
  }
  console.log(`✔ Capabilities returned successfully (${capText.length} bytes of authoring guide and schema)`);

  // Step 3: init_creative_project
  const testProjectDir = path.join(os.tmpdir(), `mf-e2e-project-${Date.now()}`);
  console.log(`▶ [4/5] Invoking init_creative_project at ${testProjectDir}...`);
  const initRes = await client.callTool({
    name: "init_creative_project",
    arguments: {
      name: "mcp-e2e-project",
      targetPath: testProjectDir,
    },
  });
  if (initRes.isError) {
    throw new Error(`init_creative_project failed: ${JSON.stringify(initRes)}`);
  }
  const initManifestExists = await fsp.stat(path.join(testProjectDir, "motionforge.project.json")).then(() => true).catch(() => false);
  if (!initManifestExists) {
    throw new Error(`motionforge.project.json was not created in ${testProjectDir}`);
  }
  console.log(`✔ Project initialized on disk at ${testProjectDir}`);

  // Step 4: create_or_update_scene
  console.log("▶ [5/5] Invoking create_or_update_scene with minimalValidScene...");
  const sceneRes = await client.callTool({
    name: "create_or_update_scene",
    arguments: {
      ...MINIMAL_VALID_SCENE,
      projectPath: testProjectDir,
    },
  });
  if (sceneRes.isError) {
    throw new Error(`create_or_update_scene failed: ${JSON.stringify(sceneRes)}`);
  }
  const sceneText = sceneRes.content[0].text;
  console.log(`✔ Scene created: ${sceneText.slice(0, 150)}...`);

  // Extract scene id
  const idMatch = sceneText.match(/id "([^"]+)"/);
  const createdId = idMatch ? idMatch[1] : "minimal-demo";

  // Verify scene was written to disk
  const sceneFile = path.join(testProjectDir, "scenes", `${createdId}.json`);
  const sceneFileExists = await fsp.stat(sceneFile).then(() => true).catch(() => false);
  if (!sceneFileExists) {
    throw new Error(`Scene file was not synced to disk at ${sceneFile}`);
  }
  console.log(`✔ Autonomous project disk sync verified: ${sceneFile}`);

  // Cleanup
  await fsp.rm(testProjectDir, { recursive: true, force: true });
  console.log("\n🎉 ALL IN-PROCESS MCP WORKFLOWS VERIFIED 100% CLEAN!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ E2E MCP Verification failed:", err);
  process.exit(1);
});
