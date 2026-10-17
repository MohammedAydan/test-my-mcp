# After Effects projects — REFERENCE ONLY

Third-party motion references and complex comps that cannot be expressed in
SceneSpec yet.

- **The engine does not read `.aep` files.** They exist so a human can inspect
  or finish a shot that MotionForge cannot reproduce.
- Anything that must ship in the final video has to be rebuilt as a SceneSpec
  layer, or pre-rendered to ProRes/PNG sequence and dropped into `../../assets/`.
- Keep files version-controlled by date (`{{PROJECT_NAME}}-logo-v03.aep`).
