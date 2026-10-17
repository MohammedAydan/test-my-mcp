import { gsap } from "gsap";
import type { SceneSpec } from "@motionforge/scene-spec";

/**
 * Minimal interactive scrubber for human inspection: play/pause, frame-accurate
 * seek, frame counter. Only mounted in preview mode (never during rendering).
 */
export function mountTimelineUI(tl: gsap.core.Timeline, scene: SceneSpec, fps: number): void {
  const totalFrames = Math.max(1, Math.round((scene.durationMs / 1000) * fps));
  const pad = (n: number) => String(Math.max(0, n)).padStart(4, "0");

  const bar = document.createElement("div");
  bar.className =
    "fixed inset-x-0 bottom-0 z-[2000] flex items-center gap-3 px-4 py-2.5 " +
    "border-t border-white/10 bg-zinc-950/85 font-mono text-xs text-zinc-300 " +
    "backdrop-blur select-none";

  const playBtn = document.createElement("button");
  playBtn.className =
    "grid h-8 w-9 place-items-center rounded-md bg-white/10 hover:bg-white/20 transition";
  playBtn.textContent = "▶";
  playBtn.title = "Play / Pause (Space)";

  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = String(totalFrames - 1);
  range.step = "1";
  range.value = "0";
  range.className = "flex-1 accent-sky-400";
  range.title = "Frame scrub (←/→ step, Shift = ×10)";

  const frameLabel = document.createElement("span");
  frameLabel.className = "tabular-nums text-zinc-400";
  frameLabel.textContent = `${pad(0)} / ${pad(totalFrames - 1)}`;

  const timeLabel = document.createElement("span");
  timeLabel.className = "tabular-nums text-zinc-400 w-16 text-right";
  timeLabel.textContent = "0.00s";

  const fpsChip = document.createElement("span");
  fpsChip.className = "rounded bg-white/10 px-2 py-1 tabular-nums";
  fpsChip.textContent = `${fps} fps`;

  const nameChip = document.createElement("span");
  nameChip.className = "hidden truncate rounded bg-white/5 px-2 py-1 sm:inline";
  nameChip.textContent = scene.name;

  bar.append(playBtn, range, frameLabel, timeLabel, fpsChip, nameChip);
  document.body.appendChild(bar);

  let playing = false;
  let raf = 0;

  const sync = () => {
    const frame = Math.min(totalFrames - 1, Math.round(tl.time() * fps));
    range.value = String(frame);
    frameLabel.textContent = `${pad(frame)} / ${pad(totalFrames - 1)}`;
    timeLabel.textContent = `${tl.time().toFixed(2)}s`;
  };

  const stop = () => {
    playing = false;
    cancelAnimationFrame(raf);
    playBtn.textContent = "▶";
  };

  const play = () => {
    if (tl.time() >= tl.duration() - 1e-3) tl.seek(0);
    playing = true;
    playBtn.textContent = "⏸";
    tl.play();
    const tick = () => {
      if (!playing) return;
      sync();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  const toggle = () => (playing ? stop() : play());
  playBtn.addEventListener("click", toggle);

  range.addEventListener("input", () => {
    stop();
    tl.pause();
    tl.seek(Number(range.value) / fps, false);
    sync();
  });

  tl.eventCallback("onComplete", () => {
    stop();
    sync();
  });

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement && e.target !== range) return;
    if (e.code === "Space") {
      e.preventDefault();
      toggle();
    } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      e.preventDefault();
      stop();
      tl.pause();
      const step = (e.code === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1);
      const frame = Math.min(totalFrames - 1, Math.max(0, Math.round(tl.time() * fps) + step));
      tl.seek(frame / fps, false);
      sync();
    }
  });

  sync();
}
