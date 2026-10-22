---
name: ai-video-creative-director
description: End-to-end creative director workflow for LLMs authoring broadcast-grade motion graphics videos over the MotionForge MCP protocol
---

# Playbook: AI Video Creative Director

This playbook provides autonomous AI agents with an end-to-end operational guide for translating client briefs into high-impact commercial video spots using the MotionForge v5.0 MCP surface.

---

## The Creative Director Execution Flow

```
1. Ingest Capabilities & Rules  (get_motion_capabilities)
               |
               v
2. Decompose Brief into Storyboard  (generate_storyboard_from_brief)
               |
               v
3. Author & Resolve Scene Specs  (create_or_update_scene with themePreset + layoutSlot)
               |
               v
4. Inspect Composition & Telemetry  (inspect_scene_keyframes & get_layer_bounds)
               |
               v
5. Critique & Auto-Fix Iteration  (critique_and_autofix_scene until score >= 95)
               |
               v
6. Choreograph Foley Audio & SFX  (auto_choreograph_audio)
               |
               v
7. Multi-Scene Sequential Export  (compose_storyboard_video)
```

---

## Detailed Step-by-Step Procedure

### Step 1: Query Motion Capabilities
Begin by querying available schemas, vocabularies, themes, and layout slots:
```json
{
  "name": "get_motion_capabilities",
  "arguments": {}
}
```
- **Inspect `minimalValidScene`:** Always use this as the foundation.
- **Inspect `themePresets`:** Select one of the 6 themes (`appleKeynoteDark`, `linearMinimal`, `stripeVibrant`, `vercelMonochrome`, `emeraldFintech`, `editorialLight`).
- **Inspect `layoutSlots`:** Note the 12 spatial slot names (`heroCenter`, `topHeader`, `topSubhead`, `bottomSubhead`, `bottomCenterCta`, `splitLeft`, `splitRight`, `gridTopLeft`, `gridTopRight`, `gridBottomLeft`, `gridBottomRight`, `centerStage`).
- **Inspect `layerFieldGuide`:** Check required properties for targeted layer kinds.

### Step 2: Decompose Brief into Storyboard
Decompose raw customer requirements into structured scenes:
```json
{
  "name": "generate_storyboard_from_brief",
  "arguments": {
    "brief": "30-second developer tools announcement for OctoFlow CLI",
    "themePreset": "appleKeynoteDark",
    "targetDurationMs": 30000,
    "canvasShape": "16:9"
  }
}
```
- Review the generated scenes list and ensure visual diversity across scenes (e.g., Problem -> Solution -> Demo -> Social Proof -> Call to Action).

### Step 3: Author and Store Scene Specs
For each scene in the storyboard, invoke `create_or_update_scene`:
```json
{
  "name": "create_or_update_scene",
  "arguments": {
    "projectPath": "projects/octoflow-launch",
    "scene": {
      "schemaVersion": 1,
      "name": "Scene 01 - Hero Reveal",
      "themePreset": "appleKeynoteDark",
      "canvas": { "shape": "16:9", "scale": 1080 },
      "durationMs": 6000,
      "assets": [],
      "fonts": [{ "family": "Inter", "weights": [400, 700] }],
      "layers": [
        {
          "id": "bg",
          "type": "background",
          "variant": { "variant": "solid", "color": "#05070e" },
          "at": 0,
          "duration": 6000
        },
        {
          "id": "headline",
          "type": "kineticText",
          "text": "Ship 10x Faster with OctoFlow",
          "layoutSlot": "heroCenter",
          "at": 500,
          "duration": 5000,
          "entrance": { "name": "slideUpFade" }
        }
      ],
      "camera": { "keyframes": [], "moves": [] },
      "transitions": [],
      "audio": { "cues": [] }
    }
  }
}
```
- If the tool returns validation issues, inspect the exact field paths, fix them, and re-post.

### Step 4: Inspect Keyframes & Layer Telemetry
Inspect visual balance and layout without paying full video render overhead:
1. **Query Layout Telemetry (Sub-second):**
   ```json
   {
     "name": "get_layer_bounds",
     "arguments": {
       "sceneId": "scene-01",
       "timesMs": [500, 2000, 4500]
     }
   }
   ```
   Check for bounding box overlaps, text clipping, and safe zone violations.
2. **Inspect Visual Keyframes:**
   ```json
   {
     "name": "inspect_scene_keyframes",
     "arguments": {
       "sceneId": "scene-01",
       "timesMs": [1000, 3000],
       "includeInlineImages": true
     }
   }
   ```
   Examine preview images (JPEG <= 960px) and `framesMeta` sidecar diagnostics.

### Step 5: Critique & Auto-Fix Loop (Target: Score >= 95)
Invoke the autonomous art director:
```json
{
  "name": "critique_and_autofix_scene",
  "arguments": {
    "sceneId": "scene-01",
    "autoApply": true,
    "targetScore": 95
  }
}
```
- The solver automatically rectifies:
  - Low WCAG contrast between text and cards.
  - Layer collisions on identical track indexes.
  - Camera viewport void exposure.
  - Text overflow and font hierarchy imbalances.
- Repeat until the critique score reaches 95 or above.

### Step 6: Choreograph Foley Audio & SFX
Align procedural sound effects with visual choreography:
```json
{
  "name": "auto_choreograph_audio",
  "arguments": {
    "sceneId": "scene-01",
    "duckMusicDuringSpeech": true,
    "intensity": "punchy"
  }
}
```
- Automatically generates audio cues using the 14 procedural SFX library (6 existing cues plus 8 new cues: `typingTick`, `mouseClick`, `notificationChime`, `bassDrop`, `glitchHit`, `softSwoosh`, `counterTick`, `ambientPad`) aligned with layer entrance and exit timestamps.

### Step 7: Compose Multi-Scene Master Video
Compile the storyboard into the final broadcast MP4:
```json
{
  "name": "compose_storyboard_video",
  "arguments": {
    "projectPath": "projects/octoflow-launch",
    "sceneIds": ["scene-01", "scene-02", "scene-03", "scene-04"],
    "transitionKind": "wipe",
    "transitionDurationMs": 500,
    "quality": "production"
  }
}
```
- Each constituent scene is rendered sequentially under single-Chromium concurrency.
- FFmpeg concatenates the scene streams with broadcast xfade transitions and outputs the final master video.
