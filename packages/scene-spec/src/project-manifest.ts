import { z } from "zod";

import { canvasShapeScaleSchema, type CanvasScale, type CanvasShape } from "./scene.js";

/**
 * `motionforge.project.json` — the manifest of a **creative project workspace**.
 *
 * A creative project is a client job: brief, brand assets, SceneSpec files and
 * renders. It lives beside (not inside) the engine monorepo, and this manifest
 * is what ties them together: which engine to talk to, which canvas/language
 * the job uses, and which scene files are expected on disk.
 *
 * This is a separate contract from `SceneSpec`, but it obeys the same rules as
 * the rest of the system: Zod-first, strict (unknown keys are errors), and
 * exported so the CLI, the tests and any agent can validate a project the same
 * way the engine validates a scene.
 */

export const PROJECT_MANIFEST_FILENAME = "motionforge.project.json";

export const PROJECT_QUALITIES = ["draft", "production"] as const;
export type ProjectQuality = (typeof PROJECT_QUALITIES)[number];

export const PROJECT_LANGUAGES = ["ar", "en", "both"] as const;
export type ProjectLanguage = (typeof PROJECT_LANGUAGES)[number];

export const PROJECT_SCENE_STATUSES = ["draft", "approved", "delivered"] as const;
export type ProjectSceneStatus = (typeof PROJECT_SCENE_STATUSES)[number];

const isoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
    "must be an ISO-8601 timestamp (e.g. 2026-01-31T09:00:00.000Z)"
  );

const httpUrl = z
  .string()
  .min(1)
  .refine((v) => /^https?:\/\/[^\s]+$/.test(v), {
    message: "must be an http(s) URL (e.g. http://127.0.0.1:4000)",
  });

const projectPath = z
  .string()
  .min(1)
  .refine((v) => !v.startsWith("/") && !v.includes("..") && !/^[A-Za-z]:/.test(v), {
    message: "must be a relative path inside the project (no leading slash, no '..')",
  });

export const projectEngineSchema = z.strictObject({
  url: httpUrl,
  preferredQuality: z.enum(PROJECT_QUALITIES).default("draft"),
});
export type ProjectEngine = z.infer<typeof projectEngineSchema>;

export const projectCanvasSchema = canvasShapeScaleSchema;
export type ProjectCanvas = z.infer<typeof projectCanvasSchema>;

export const projectLanguageSchema = z.strictObject({
  /** the language copy is written in first; `both` for bilingual deliverables */
  primary: z.enum(PROJECT_LANGUAGES),
  secondary: z.enum(PROJECT_LANGUAGES).optional(),
});
export type ProjectLanguageConfig = z.infer<typeof projectLanguageSchema>;

export const projectBrandSchema = z.strictObject({
  /** named colour tokens; free-form keys, `#rrggbb` values */
  colors: z.record(z.string().min(1), z.string().min(1)),
  /** asset id declared in a SceneSpec `assets[]` entry, or null until uploaded */
  logoAssetId: z.string().min(1).nullable().default(null),
});
export type ProjectBrand = z.infer<typeof projectBrandSchema>;

export const projectSceneRefSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "must be alphanumeric with - or _"),
  /** path to the SceneSpec JSON, relative to the project root */
  file: projectPath.refine((v) => v.endsWith(".json"), "must point at a .json file"),
  status: z.enum(PROJECT_SCENE_STATUSES).default("draft"),
});
export type ProjectSceneRef = z.infer<typeof projectSceneRefSchema>;

export const projectWorkflowSchema = z.strictObject({
  /** block `production` renders on a keyframe inspection (the project's quality gate) */
  requireInspectBeforeProduction: z.boolean().default(true),
  autoOpenPreview: z.boolean().default(true),
});
export type ProjectWorkflow = z.infer<typeof projectWorkflowSchema>;

export const projectManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(80),
  createdAt: isoTimestamp,
  engine: projectEngineSchema,
  canvasDefault: projectCanvasSchema,
  language: projectLanguageSchema,
  brand: projectBrandSchema,
  scenes: z.array(projectSceneRefSchema).max(64),
  workflow: projectWorkflowSchema,
});
export type ProjectManifest = z.infer<typeof projectManifestSchema>;
export type ProjectManifestInput = z.input<typeof projectManifestSchema>;

/**
 * Validate a manifest with the same error shape the engine uses for scenes, so
 * `init-project`, `sync-scene` and the tests all report problems identically.
 */
export function validateProjectManifest(
  input: unknown
): { ok: true; manifest: ProjectManifest } | { ok: false; issues: string[] } {
  const parsed = projectManifestSchema.safeParse(input);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`
    ),
  };
}

/** A minimal, valid manifest — the base `init-project` writes. */
export function minimalProjectManifest(input: {
  name: string;
  createdAt: string;
  engineUrl: string;
  canvas?: { shape: CanvasShape; scale: CanvasScale };
  language?: ProjectLanguage;
  preferredQuality?: ProjectQuality;
}): ProjectManifest {
  const parsed = projectManifestSchema.parse({
    schemaVersion: 1,
    name: input.name,
    createdAt: input.createdAt,
    engine: { url: input.engineUrl, preferredQuality: input.preferredQuality ?? "draft" },
    canvasDefault: input.canvas ?? { shape: "16:9", scale: 1080 },
    language: { primary: input.language ?? "ar", secondary: "en" },
    brand: {
      colors: { bg: "#05070d", accent: "#38bdf8", text: "#ffffff" },
      logoAssetId: null,
    },
    scenes: [
      { id: "scene-01", file: "scenes/scene-01.json", status: "draft" },
    ],
    workflow: { requireInspectBeforeProduction: true, autoOpenPreview: true },
  });
  return parsed;
}
