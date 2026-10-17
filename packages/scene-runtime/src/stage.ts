/**
 * The fixed design-space canvas: `#stage` is exactly canvas-sized and scaled
 * uniformly to fit the window (preview) or kept 1:1 (render mode).
 * All layers live inside `#camera-rig` (2.5D) → `#stage-content` (grade target).
 */
export interface Stage {
  stage: HTMLElement;
  rig: HTMLElement;
  content: HTMLElement;
  width: number;
  height: number;
  fitToWindow(): void;
}

export function createStage(width: number, height: number): Stage {
  const viewport = document.getElementById("viewport");
  if (!viewport) throw new Error("#viewport missing from index.html");

  const stage = document.createElement("div");
  stage.id = "stage";
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;

  const rig = document.createElement("div");
  rig.id = "camera-rig";

  const content = document.createElement("div");
  content.id = "stage-content";

  rig.appendChild(content);
  stage.appendChild(rig);
  viewport.appendChild(stage);

  const stageRef: Stage = {
    stage,
    rig,
    content,
    width,
    height,
    fitToWindow() {
      const renderMode = new URLSearchParams(window.location.search).get("render") === "1";
      const scale = renderMode
        ? 1
        : Math.min(window.innerWidth / width, window.innerHeight / height);
      stage.style.transform = `scale(${scale})`;
    },
  };

  stageRef.fitToWindow();
  if (!renderMode()) {
    window.addEventListener("resize", () => stageRef.fitToWindow());
  }
  return stageRef;
}

function renderMode(): boolean {
  return new URLSearchParams(window.location.search).get("render") === "1";
}

/** Center of `el` in design-space, as percent of the rig. */
export function centerPctInRig(rig: HTMLElement, el: HTMLElement): { xPct: number; yPct: number } {
  const designW = rig.offsetWidth || 1;
  const designH = rig.offsetHeight || 1;
  const rigBox = rig.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  // undo any preview scaling applied above the rig
  const scale = rigBox.width / designW || 1;
  const xPx = (box.left + box.width / 2 - rigBox.left) / scale;
  const yPx = (box.top + box.height / 2 - rigBox.top) / scale;
  return {
    xPct: (xPx / designW) * 100,
    yPct: (yPx / designH) * 100,
  };
}
