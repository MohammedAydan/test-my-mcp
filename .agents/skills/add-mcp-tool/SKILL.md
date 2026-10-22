---
name: add-mcp-tool
description: Standardized procedure for adding an MCP tool backed by an in-process EngineCore domain method
---

# Playbook: Adding an MCP Tool

This playbook defines the required workflow for adding a new Model Context Protocol (MCP) tool to MotionForge.

## Architectural Constraints
- **In-Process Communication:** `mcp-server` talks directly to `core-engine` in-process. Never introduce HTTP endpoints, Fastify routes, or network sockets.
- **Dual Output Payload:** Every MCP tool handler MUST return both:
  1. A human/agent-readable `content` text block summarizing results and actionable next steps.
  2. A machine-readable `structuredContent` JSON payload containing exact metrics, identifiers, and reports.
- **Error Transparency:** Engine errors and Zod validation issues must never be swallowed; pass them verbatim to the caller.

---

## Step 1: Implement Domain Method on EngineCore

Edit `packages/core-engine/src/engine-core.ts`:
1. Define the domain input interface and return type (sharing schemas with `@motionforge/scene-spec/src/contracts.ts` when applicable).
2. Implement the method on `EngineCore`:
   ```typescript
   export interface MyToolOptions {
     sceneId: string;
     strictMode?: boolean;
   }

   export interface MyToolResult {
     success: boolean;
     score: number;
     details: string[];
   }

   // Inside EngineCore class:
   async executeMyFeature(opts: MyToolOptions): Promise<MyToolResult> {
     // Implement domain logic here
     return {
       success: true,
       score: 98,
       details: ["Rule A satisfied", "Rule B satisfied"],
     };
   }
   ```
3. Export the method and types from `packages/core-engine/src/index.ts`.

---

## Step 2: Forwarding in Engine Client

Edit `packages/mcp-server/src/engine-client.ts`:
1. Export a client wrapper function that retrieves the in-process core via `getInProcessCore()`:
   ```typescript
   export async function executeMyFeature(opts: MyToolOptions): Promise<MyToolResult> {
     const core = await getInProcessCore();
     return core.executeMyFeature(opts);
   }
   ```
2. Re-export necessary types so `tools.ts` can consume them cleanly.

---

## Step 3: Register Tool in MCP Server

Edit `packages/mcp-server/src/tools.ts`:
1. Append the new tool name to the exported `TOOL_NAMES` array.
2. Define the Zod parameter schema for the tool input.
3. Register the tool on `server.tool()`:
   ```typescript
   server.tool(
     "my_new_tool",
     "Description of what the tool accomplishes and when an agent should invoke it.",
     {
       sceneId: z.string().describe("The ID of the target scene"),
       strictMode: z.boolean().default(true).describe("Enforce strict validation"),
     },
     async ({ sceneId, strictMode }) => {
       try {
         const result = await engineClient.executeMyFeature({ sceneId, strictMode });

         return {
           content: [
             {
               type: "text",
               text: `Feature executed successfully for scene "${sceneId}". Score: ${result.score}/100.\n` +
                     `Details:\n` +
                     result.details.map((d) => `- ${d}`).join("\n"),
             },
           ],
           structuredContent: result,
         };
       } catch (err) {
         if (err instanceof EngineError) {
           return {
             isError: true,
             content: [
               {
                 type: "text",
                 text: `Engine error (${err.status}): ${err.message}` +
                       (err.issues ? `\nIssues:\n${err.issues.map((i) => ` - ${i}`).join("\n")}` : ""),
               },
             ],
           };
         }
         throw err;
       }
     }
   );
   ```

---

## Step 4: Contract and Integration Tests

Edit `packages/mcp-server/tests/tools.test.ts`:
1. Verify that `TOOL_NAMES` contains the new tool name.
2. Assert that calling the tool with valid parameters returns both `content` and `structuredContent`.
3. Assert that calling the tool with invalid parameters returns clear diagnostic error issues.
4. Execute verification:
   ```bash
   npm test -w @motionforge/mcp-server
   npm run typecheck -ws
   ```
