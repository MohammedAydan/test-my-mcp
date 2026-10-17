import { gsap } from "gsap";

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
  setSize(width: number, height: number): void;
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
    setSize(nextWidth: number, nextHeight: number) {
      stageRef.width = nextWidth;
      stageRef.height = nextHeight;
      stage.style.width = `${nextWidth}px`;
      stage.style.height = `${nextHeight}px`;
      stageRef.fitToWindow();
    },
    fitToWindow() {
      const params = new URLSearchParams(window.location.search);
      const renderMode = params.get("render") === "1";
      const fitParam = params.get("fit") === "1";
      // render mode captures 1:1 unless ?fit=1 asks for a downscaled fit (draft)
      const scale =
        renderMode && !fitParam ? 1 : Math.min(window.innerWidth / width, window.innerHeight / height);
      // explicit centering: the canvas is usually LARGER than the viewport, and
      // grid centering of an oversized item is not dependable across engines
      stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    },
  };

  stageRef.fitToWindow();
  if (!renderMode()) {
    window.addEventListener("resize", () => stageRef.fitToWindow());
  }
  return stageRef;
}

/**
 * Wipe the stage back to a pristine state before a scene is rebuilt.
 *
 * Live preview rebuilds in place, so anything left behind becomes visible
 * ghosting: stale layer DOM, transition overlays parented to the rig, and
 * inline camera transforms from the previous scene's rig. Killing the timeline
 * (done by the caller) removes the tweens; this removes their targets and
 * their inline styles.
 */
export function resetStage(stage: Stage): void {
  // transition overlays are appended directly to the rig, layers under content
  for (const child of Array.from(stage.rig.children)) {
    if (child !== stage.content) child.remove();
  }
  stage.content.replaceChildren();
  gsap.set(stage.rig, { clearProps: "all" });
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
