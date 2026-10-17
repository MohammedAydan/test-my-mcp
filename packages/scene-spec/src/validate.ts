import type { z } from "zod";
import { sceneSpecSchema, type SceneSpec } from "./scene.js";

export type SceneValidation =
  | { ok: true; scene: SceneSpec }
  | { ok: false; issues: string[] };

/**
 * Validate an untrusted SceneSpec (e.g. JSON from the MCP tool or HTTP body).
 * Returns flattened, human-readable issues so an LLM can self-correct.
 */
export function validateScene(input: unknown): SceneValidation {
  const result = sceneSpecSchema.safeParse(input);
  if (result.success) {
    return { ok: true, scene: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`
    ),
  };
}

/** Validate and throw (for internal call sites that already trust the source). */
export function parseScene(input: unknown): SceneSpec {
  return sceneSpecSchema.parse(input);
}

export type SceneSpecInput = z.input<typeof sceneSpecSchema>;
