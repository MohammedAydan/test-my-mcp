import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from '../../state/store.js';
import type { StudioLayer } from '../../types.js';
import { capturePointer, releasePointer } from '../../services/pointer-capture.js';

/**
 * The Program Monitor's direct-manipulation overlay.
 *
 * A transparent SVG layer over the `mf-runtime://` iframe:
 *  - a pixel-accurate selection box with 8 resize handles and a rotation stem,
 *  - magnetic SMART ALIGNMENT GUIDES snapped to the canvas centre, the safe
 *    margins and every other visible layer's edges and centres,
 *  - a live coordinate HUD,
 *  - hand-tool panning and Ctrl+wheel zooming.
 *
 * Performance rule: the drag writes to the store IN PLACE (`patchLayer`) and
 * pushes the transform to the runtime over `postMessage`, so the preview keeps
 * up with the pointer at 60fps. The undo entry and the save happen ONCE, at
 * the end of the gesture.
 */

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SnapGuide {
  axis: 'x' | 'y';
  pos: number;
  label?: string;
  kind: 'canvas' | 'layer';
}

export interface CanvasOverlayProps {
  containerRef: () => HTMLDivElement | undefined;
  iframeRef: () => HTMLIFrameElement | undefined;
}

export const CanvasOverlay: Component<CanvasOverlayProps> = (props) => {
  const state = store.state;

  const [dragMode, setDragMode] = createSignal<'none' | 'move' | 'resize' | 'rotate' | 'marquee' | 'pan'>('none');
  const [resizeHandle, setResizeHandle] = createSignal<string | null>(null);
  const [activeGuides, setActiveGuides] = createSignal<SnapGuide[]>([]);
  const [marqueeRect, setMarqueeRect] = createSignal<Rect | null>(null);
  const [hoveredLayerId, setHoveredLayerId] = createSignal<string | null>(null);
  const [hud, setHud] = createSignal<{ x: number; y: number; dx: number } | null>(null);

  let dragStartScreen: Point = { x: 0, y: 0 };
  let dragStartCanvas: Point = { x: 0, y: 0 };
  let initialProps: Record<string, unknown> = {};
  let isSpacePressed = false;
  let hasDragged = false;
  let pendingDescription: string | null = null;

  /* ── canvas metrics ──────────────────────────────────────────────────── */

  const canvasWidth = () => {
    const shape = state.scene?.canvas?.shape ?? '16:9';
    const scale = state.scene?.canvas?.scale ?? 1080;
    if (shape === '9:16') return Math.round((scale * 9) / 16);
    if (shape === '1:1') return scale;
    if (shape === '4:5') return Math.round((scale * 4) / 5);
    return Math.round((scale * 16) / 9);
  };

  const canvasHeight = () => state.scene?.canvas?.scale ?? 1080;

  const getMetrics = () => {
    const container = props.containerRef();
    const cWidth = container?.clientWidth ?? 1280;
    const cHeight = container?.clientHeight ?? 720;
    const cW = canvasWidth();
    const cH = canvasHeight();
    const fitScale = Math.min((cWidth - 40) / cW, (cHeight - 40) / cH);
    const totalScale = fitScale * state.viewportZoom;
    const centerX = cWidth / 2 + state.viewportPan.x;
    const centerY = cHeight / 2 + state.viewportPan.y;
    return {
      cWidth,
      cHeight,
      cW,
      cH,
      totalScale,
      centerX,
      centerY,
      stageX: centerX - (cW / 2) * totalScale,
      stageY: centerY - (cH / 2) * totalScale,
      stageW: cW * totalScale,
      stageH: cH * totalScale,
    };
  };

  const screenToCanvas = (point: Point): Point => {
    const m = getMetrics();
    return {
      x: m.cW / 2 + (point.x - m.centerX) / m.totalScale,
      y: m.cH / 2 + (point.y - m.centerY) / m.totalScale,
    };
  };

  const canvasToScreen = (point: Point): Point => {
    const m = getMetrics();
    return {
      x: m.centerX + (point.x - m.cW / 2) * m.totalScale,
      y: m.centerY + (point.y - m.cH / 2) * m.totalScale,
    };
  };

  /* ── layer geometry ──────────────────────────────────────────────────── */

  const getLayerBox = (layer: StudioLayer): Rect & { rotation: number } => {
    const cached = state.layerBounds[layer.id];
    const cW = canvasWidth();
    const cH = canvasHeight();
    const rotation = layer.rotation ?? 0;

    if (layer.type === 'background' || layer.type === 'foregroundFX') {
      return { x: 0, y: 0, width: cW, height: cH, rotation: 0 };
    }

    const position = layer.position ?? { xPct: 50, yPct: 50 };
    const centerX = (position.xPct / 100) * cW;
    const centerY = (position.yPct / 100) * cH;

    let width = cached?.width ?? 300;
    let height = cached?.height ?? 100;

    if (!cached) {
      if (layer.type === 'kineticText') {
        const size = layer.sizePx ?? 64;
        const textLen = layer.text?.length ?? 10;
        width = Math.min(cW * 0.7, textLen * size * 0.55);
        height = size * 1.3;
      } else if (layer.type === 'card') {
        width = (layer.variant?.widthPx as number) ?? 360;
        height = 120;
      } else if (layer.type === 'imageLogo' || layer.type === 'lottie') {
        width = layer.widthPx ?? 200;
        height = layer.heightPx ?? width;
      }
    }

    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      rotation: cached?.rotation ?? rotation,
    };
  };

  const selectedLayers = createMemo(() => {
    const ids =
      state.selectedLayerIds.length > 0
        ? state.selectedLayerIds
        : state.selectedLayerId
        ? [state.selectedLayerId]
        : [];
    return (state.scene?.layers ?? []).filter((l) => ids.includes(l.id));
  });

  const primarySelectedLayer = createMemo(() => selectedLayers()[0] ?? null);

  /* ── smart alignment guides ──────────────────────────────────────────── */

  const findSnaps = (
    targetX: number,
    targetY: number,
    targetW: number,
    targetH: number,
    ignoreLayerId: string
  ) => {
    if (!state.snapEnabled) return { x: targetX, y: targetY, guides: [] as SnapGuide[] };

    const threshold = 6;
    const guides: SnapGuide[] = [];
    const cW = canvasWidth();
    const cH = canvasHeight();

    const targetCenterX = targetX + targetW / 2;
    const targetCenterY = targetY + targetH / 2;
    const targetRight = targetX + targetW;
    const targetBottom = targetY + targetH;

    const canvasX = [
      { val: 0, label: 'Canvas Left', kind: 'canvas' as const },
      { val: cW / 2, label: 'Canvas Center', kind: 'canvas' as const },
      { val: cW, label: 'Canvas Right', kind: 'canvas' as const },
    ];
    const canvasY = [
      { val: 0, label: 'Canvas Top', kind: 'canvas' as const },
      { val: cH / 2, label: 'Canvas Center', kind: 'canvas' as const },
      { val: cH, label: 'Canvas Bottom', kind: 'canvas' as const },
    ];

    const layerX: Array<{ val: number; label: string; kind: 'layer' }> = [];
    const layerY: Array<{ val: number; label: string; kind: 'layer' }> = [];
    for (const layer of state.scene?.layers ?? []) {
      if (layer.id === ignoreLayerId) continue;
      if (layer.type === 'background' || layer.type === 'foregroundFX') continue;
      if (layer.visible === false) continue;
      const box = getLayerBox(layer);
      const label = layer.name ?? layer.id;
      layerX.push(
        { val: box.x, label, kind: 'layer' },
        { val: box.x + box.width / 2, label, kind: 'layer' },
        { val: box.x + box.width, label, kind: 'layer' }
      );
      layerY.push(
        { val: box.y, label, kind: 'layer' },
        { val: box.y + box.height / 2, label, kind: 'layer' },
        { val: box.y + box.height, label, kind: 'layer' }
      );
    }

    const snapX = [...canvasX, ...layerX];
    const snapY = [...canvasY, ...layerY];

    let snappedX = targetX;
    let snappedY = targetY;

    for (const candidate of snapX) {
      if (Math.abs(targetCenterX - candidate.val) < threshold) {
        snappedX = candidate.val - targetW / 2;
        guides.push({ axis: 'x', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
      if (Math.abs(targetX - candidate.val) < threshold) {
        snappedX = candidate.val;
        guides.push({ axis: 'x', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
      if (Math.abs(targetRight - candidate.val) < threshold) {
        snappedX = candidate.val - targetW;
        guides.push({ axis: 'x', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
    }

    for (const candidate of snapY) {
      if (Math.abs(targetCenterY - candidate.val) < threshold) {
        snappedY = candidate.val - targetH / 2;
        guides.push({ axis: 'y', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
      if (Math.abs(targetY - candidate.val) < threshold) {
        snappedY = candidate.val;
        guides.push({ axis: 'y', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
      if (Math.abs(targetBottom - candidate.val) < threshold) {
        snappedY = candidate.val - targetH;
        guides.push({ axis: 'y', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
    }

    return { x: snappedX, y: snappedY, guides };
  };

  /* ── keyboard ────────────────────────────────────────────────────────── */

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (event.code === 'Space') {
        isSpacePressed = true;
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'v') store.setActiveTool('select');
        else if (key === 'h') store.setActiveTool('hand');
        else if (key === 'c') store.setActiveTool('razor');
        else if (key === 't') store.setActiveTool('text');
        else if (key === 'r') store.setActiveTool('shape');
      } else if (event.ctrlKey || event.metaKey) {
        if (event.key === '0') {
          event.preventDefault();
          store.setViewportZoom(1);
          store.setViewportPan({ x: 0, y: 0 });
        } else if (event.key === '1') {
          event.preventDefault();
          store.setViewportZoom(1);
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') isSpacePressed = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    });
  });

  /* ── runtime sync ────────────────────────────────────────────────────── */

  const postTransform = (payload: Record<string, unknown>) => {
    const iframe = props.iframeRef();
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: 'ephemeralTransform', ...payload }, '*');
  };

  createEffect(() => {
    const layers = state.scene?.layers;
    const iframe = props.iframeRef();
    if (!layers || !iframe?.contentWindow) return;
    if (dragMode() !== 'none') return;
    for (const layer of layers) {
      if (!layer.position) continue;
      postTransform({
        layerId: layer.id,
        xPct: layer.position.xPct,
        yPct: layer.position.yPct,
        rotation: layer.rotation ?? 0,
      });
    }
  });

  /* ── pointer handling ────────────────────────────────────────────────── */

  const handlePointerDown = (event: PointerEvent) => {
    const container = props.containerRef();
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    dragStartScreen = { x: screenX, y: screenY };
    dragStartCanvas = screenToCanvas({ x: screenX, y: screenY });

    if (state.activeTool === 'hand' || isSpacePressed || event.button === 1) {
      setDragMode('pan');
      capturePointer(event.currentTarget as HTMLElement, event.pointerId);
      return;
    }

    const targetEl = event.target as HTMLElement | SVGElement;
    const handleType = targetEl.getAttribute?.('data-handle');
    if (handleType) {
      setResizeHandle(handleType);
      const selected = primarySelectedLayer();
      if (selected) {
        const box = getLayerBox(selected);
        initialProps = {
          xPct: selected.position?.xPct ?? 50,
          yPct: selected.position?.yPct ?? 50,
          width: box.width,
          height: box.height,
          sizePx: selected.sizePx,
          rotation: box.rotation,
        };
        hasDragged = false;
        pendingDescription = `Transform layer: ${selected.name ?? selected.id}`;
        setDragMode(handleType === 'rotate' ? 'rotate' : 'resize');
      }
      capturePointer(event.currentTarget as HTMLElement, event.pointerId);
      return;
    }

    const clickedLayerId = targetEl.getAttribute?.('data-layer-id');
    let hitLayer: StudioLayer | null = null;
    if (clickedLayerId) {
      hitLayer = (state.scene?.layers ?? []).find((l) => l.id === clickedLayerId) ?? null;
    }
    if (!hitLayer) {
      for (let i = (state.scene?.layers.length ?? 0) - 1; i >= 0; i--) {
        const layer = state.scene?.layers?.[i];
        if (!layer) continue;
        if (layer.type === 'background' || layer.type === 'foregroundFX') continue;
        if (layer.visible === false) continue;
        const box = getLayerBox(layer);
        if (
          dragStartCanvas.x >= box.x &&
          dragStartCanvas.x <= box.x + box.width &&
          dragStartCanvas.y >= box.y &&
          dragStartCanvas.y <= box.y + box.height
        ) {
          hitLayer = layer;
          break;
        }
      }
    }

    if (hitLayer) {
      if (hitLayer.locked) {
        store.addToast(`Layer "${hitLayer.name ?? hitLayer.id}" is locked`, 'warning');
        return;
      }
      if (!selectedLayers().some((l) => l.id === hitLayer!.id)) {
        store.selectLayer(hitLayer.id, event.shiftKey);
      }
      hasDragged = false;
      pendingDescription = `Move layer: ${hitLayer.name ?? hitLayer.id}`;
      setDragMode('move');
      const box = getLayerBox(hitLayer);
      initialProps = {
        layerId: hitLayer.id,
        xPct: hitLayer.position?.xPct ?? 50,
        yPct: hitLayer.position?.yPct ?? 50,
        boxX: box.x,
        boxY: box.y,
        boxW: box.width,
        boxH: box.height,
      };
      capturePointer(event.currentTarget as HTMLElement, event.pointerId);
      return;
    }

    if (!event.shiftKey) store.selectLayer(null);
    hasDragged = false;
    pendingDescription = null;
    setDragMode('marquee');
    setMarqueeRect({ x: dragStartCanvas.x, y: dragStartCanvas.y, width: 0, height: 0 });
    capturePointer(event.currentTarget as HTMLElement, event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const container = props.containerRef();
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const currentScreen: Point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const currentCanvas = screenToCanvas(currentScreen);
    const mode = dragMode();

    if (mode === 'none') {
      if (state.scene?.layers && state.activeTool === 'select') {
        let hoverId: string | null = null;
        for (let i = state.scene.layers.length - 1; i >= 0; i--) {
          const layer = state.scene.layers[i];
          if (!layer) continue;
          if (layer.type === 'background' || layer.type === 'foregroundFX') continue;
          if (layer.visible === false) continue;
          const box = getLayerBox(layer);
          if (
            currentCanvas.x >= box.x &&
            currentCanvas.x <= box.x + box.width &&
            currentCanvas.y >= box.y &&
            currentCanvas.y <= box.y + box.height
          ) {
            hoverId = layer.id;
            break;
          }
        }
        setHoveredLayerId(hoverId);
      }
      return;
    }

    if (mode === 'pan') {
      const dx = currentScreen.x - dragStartScreen.x;
      const dy = currentScreen.y - dragStartScreen.y;
      dragStartScreen = currentScreen;
      store.setViewportPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }

    if (mode === 'move') {
      let dx = currentCanvas.x - dragStartCanvas.x;
      let dy = currentCanvas.y - dragStartCanvas.y;
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }

      if (!hasDragged) {
        if (Math.hypot(dx, dy) < 2) return;
        hasDragged = true;
        store.pushHistory(pendingDescription ?? 'Move layer');
      }

      const layerId = String(initialProps.layerId);
      const initBoxX = Number(initialProps.boxX);
      const initBoxY = Number(initialProps.boxY);
      const initBoxW = Number(initialProps.boxW);
      const initBoxH = Number(initialProps.boxH);

      let targetX = initBoxX + dx;
      let targetY = initBoxY + dy;

      if (!event.altKey) {
        const snap = findSnaps(targetX, targetY, initBoxW, initBoxH, layerId);
        targetX = snap.x;
        targetY = snap.y;
        setActiveGuides(snap.guides);
      } else {
        setActiveGuides([]);
      }

      const cW = canvasWidth();
      const cH = canvasHeight();
      const newXPct = Math.round(((targetX + initBoxW / 2) / cW) * 1000) / 10;
      const newYPct = Math.round(((targetY + initBoxH / 2) / cH) * 1000) / 10;

      store.patchLayer(layerId, { position: { xPct: newXPct, yPct: newYPct } });
      postTransform({ layerId, xPct: newXPct, yPct: newYPct });

      setHud({
        x: newXPct,
        y: newYPct,
        dx: Math.round((newXPct - Number(initialProps.xPct)) * 10) / 10,
      });
      return;
    }

    if (mode === 'resize') {
      const handle = resizeHandle();
      const selected = primarySelectedLayer();
      if (!selected || !handle) return;

      const dx = currentCanvas.x - dragStartCanvas.x;
      const dy = currentCanvas.y - dragStartCanvas.y;
      if (!hasDragged) {
        if (Math.hypot(dx, dy) < 2) return;
        hasDragged = true;
        store.pushHistory(pendingDescription ?? 'Transform layer');
      }

      const initW = Number(initialProps.width);
      const initH = Number(initialProps.height);
      let newW = initW;
      let newH = initH;
      if (handle.includes('e')) newW = Math.max(40, initW + dx);
      if (handle.includes('w')) newW = Math.max(40, initW - dx);
      if (handle.includes('s')) newH = Math.max(20, initH + dy);
      if (handle.includes('n')) newH = Math.max(20, initH - dy);

      if (selected.type === 'kineticText') {
        const scaleFactor = Math.max(0.3, newH / initH);
        store.patchLayer(selected.id, { sizePx: Math.round(Number(initialProps.sizePx) * scaleFactor) });
      } else if (selected.type === 'card') {
        store.patchLayer(selected.id, { variant: { ...(selected.variant ?? {}), widthPx: Math.round(newW) } });
      } else if (selected.type === 'imageLogo' || selected.type === 'lottie') {
        store.patchLayer(selected.id, { widthPx: Math.round(newW) });
      }

      postTransform({ layerId: selected.id, widthPx: Math.round(newW), heightPx: Math.round(newH) });
      return;
    }

    if (mode === 'rotate') {
      const selected = primarySelectedLayer();
      if (!selected) return;
      const dx = currentCanvas.x - dragStartCanvas.x;
      const dy = currentCanvas.y - dragStartCanvas.y;
      if (!hasDragged) {
        if (Math.hypot(dx, dy) < 2) return;
        hasDragged = true;
        store.pushHistory(pendingDescription ?? 'Rotate layer');
      }
      const box = getLayerBox(selected);
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      const angleRad = Math.atan2(currentCanvas.y - centerY, currentCanvas.x - centerX);
      let angleDeg = Math.round((angleRad * 180) / Math.PI + 90);
      while (angleDeg > 180) angleDeg -= 360;
      while (angleDeg < -180) angleDeg += 360;
      if (event.shiftKey) angleDeg = Math.round(angleDeg / 15) * 15;

      store.patchLayer(selected.id, { rotation: angleDeg });
      postTransform({ layerId: selected.id, rotation: angleDeg });
      return;
    }

    if (mode === 'marquee') {
      setMarqueeRect({
        x: Math.min(dragStartCanvas.x, currentCanvas.x),
        y: Math.min(dragStartCanvas.y, currentCanvas.y),
        width: Math.abs(currentCanvas.x - dragStartCanvas.x),
        height: Math.abs(currentCanvas.y - dragStartCanvas.y),
      });
    }
  };

  const handlePointerUp = () => {
    const mode = dragMode();
    if (hasDragged && (mode === 'move' || mode === 'resize' || mode === 'rotate')) {
      // ONE atomic save for the whole gesture
      void store.executeSave();
    } else if (mode === 'marquee' && marqueeRect()) {
      const m = marqueeRect()!;
      if (m.width > 5 && m.height > 5 && state.scene?.layers) {
        const intersected: string[] = [];
        for (const layer of state.scene.layers) {
          if (layer.type === 'background' || layer.type === 'foregroundFX') continue;
          const box = getLayerBox(layer);
          if (box.x < m.x + m.width && box.x + box.width > m.x && box.y < m.y + m.height && box.y + box.height > m.y) {
            intersected.push(layer.id);
          }
        }
        if (intersected.length > 0) {
          store.setState({
            selectedLayerId: intersected[0],
            selectedLayerIds: intersected,
          });
        }
      }
    }

    hasDragged = false;
    pendingDescription = null;
    setDragMode('none');
    setResizeHandle(null);
    setActiveGuides([]);
    setMarqueeRect(null);
    setHud(null);
  };

  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      const next = Math.max(0.25, Math.min(4, Math.round((state.viewportZoom + delta) * 100) / 100));
      store.setViewportZoom(next);
    }
  };

  /* ── rendering helpers ───────────────────────────────────────────────── */

  const getScreenBox = (box: Rect & { rotation: number }) => {
    const tl = canvasToScreen({ x: box.x, y: box.y });
    const br = canvasToScreen({ x: box.x + box.width, y: box.y + box.height });
    return {
      x: tl.x,
      y: tl.y,
      width: br.x - tl.x,
      height: br.y - tl.y,
      rotation: box.rotation,
      centerX: (tl.x + br.x) / 2,
      centerY: (tl.y + br.y) / 2,
    };
  };

  const cursorClass = () => {
    if (state.activeTool === 'hand' || isSpacePressed) {
      return dragMode() === 'pan' ? 'is-panning' : 'is-hand';
    }
    if (state.activeTool === 'razor') return 'is-razor';
    return '';
  };

  return (
    <div
      id="canvas-overlay"
      class={`mf-viewport-overlay ${cursorClass()}`}
      style={{ 'pointer-events': 'auto' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      <svg class="w-full h-full overflow-visible pointer-events-none">
        {/* smart alignment guides */}
        <For each={activeGuides()}>
          {(guide) => {
            const color = guide.kind === 'canvas' ? '#38bdf8' : '#f59e0b';
            if (guide.axis === 'x') {
              const pt = canvasToScreen({ x: guide.pos, y: 0 });
              return (
                <g class="snap-guide-group">
                  <line x1={pt.x} y1={0} x2={pt.x} y2="100%" stroke={color} stroke-width="1" stroke-dasharray="4 3" />
                  <Show when={guide.label}>
                    <rect
                      x={pt.x + 4}
                      y={4}
                      width={guide.label!.length * 6 + 8}
                      height={14}
                      rx={2}
                      fill="#090a0d"
                      fill-opacity="0.9"
                      stroke={color}
                      stroke-width="0.75"
                    />
                    <text x={pt.x + 8} y={14} fill={color} font-size="9" font-family="monospace">
                      {guide.label}
                    </text>
                  </Show>
                </g>
              );
            }
            const pt = canvasToScreen({ x: 0, y: guide.pos });
            return (
              <g class="snap-guide-group">
                <line x1={0} y1={pt.y} x2="100%" y2={pt.y} stroke={color} stroke-width="1" stroke-dasharray="4 3" />
                <Show when={guide.label}>
                  <rect
                    x={4}
                    y={pt.y - 18}
                    width={guide.label!.length * 6 + 8}
                    height={14}
                    rx={2}
                    fill="#090a0d"
                    fill-opacity="0.9"
                    stroke={color}
                    stroke-width="0.75"
                  />
                  <text x={8} y={pt.y - 7} fill={color} font-size="9" font-family="monospace">
                    {guide.label}
                  </text>
                </Show>
              </g>
            );
          }}
        </For>

        {/* marquee */}
        <Show when={marqueeRect()}>
          {(() => {
            const m = marqueeRect()!;
            const tl = canvasToScreen({ x: m.x, y: m.y });
            const br = canvasToScreen({ x: m.x + m.width, y: m.y + m.height });
            return (
              <rect
                x={tl.x}
                y={tl.y}
                width={Math.max(1, br.x - tl.x)}
                height={Math.max(1, br.y - tl.y)}
                fill="rgba(56, 189, 248, 0.10)"
                stroke="#38bdf8"
                stroke-width="1"
                stroke-dasharray="3 3"
              />
            );
          })()}
        </Show>

        {/* hovered layer outline */}
        <Show
          when={
            hoveredLayerId() &&
            !selectedLayers().some((l) => l.id === hoveredLayerId()) &&
            state.scene?.layers
          }
        >
          {(() => {
            const layer = state.scene!.layers.find((x) => x.id === hoveredLayerId());
            if (!layer) return null;
            const b = getScreenBox(getLayerBox(layer));
            return (
              <g transform={`rotate(${b.rotation} ${b.centerX} ${b.centerY})`}>
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.width}
                  height={b.height}
                  fill="none"
                  stroke="#38bdf8"
                  stroke-opacity="0.5"
                  stroke-width="1"
                  stroke-dasharray="3 3"
                />
              </g>
            );
          })()}
        </Show>

        {/* selection boxes */}
        <For each={selectedLayers()}>
          {(layer) => {
            const b = createMemo(() => getScreenBox(getLayerBox(layer)));
            const isPrimary = createMemo(() => primarySelectedLayer()?.id === layer.id);
            return (
              <g transform={`rotate(${b().rotation} ${b().centerX} ${b().centerY})`}>
                <rect
                  id="selection-bounding-box"
                  data-layer-id={layer.id}
                  x={b().x}
                  y={b().y}
                  width={b().width}
                  height={b().height}
                  fill="rgba(45, 140, 235, 0.05)"
                  stroke="#2d8ceb"
                  stroke-width="1"
                  class="cursor-move pointer-events-auto"
                />

                <Show when={isPrimary()}>
                  <line x1={b().centerX} y1={b().y} x2={b().centerX} y2={b().y - 18} stroke="#2d8ceb" stroke-width="1" />
                  <circle
                    cx={b().centerX}
                    cy={b().y - 18}
                    r={4}
                    fill="#2d8ceb"
                    stroke="#ffffff"
                    stroke-width="1.25"
                    data-handle="rotate"
                    class="cursor-crosshair pointer-events-auto"
                  />

                  <For
                    each={[
                      { k: 'nw', x: b().x - 3.5, y: b().y - 3.5, c: 'cursor-nwse-resize' },
                      { k: 'ne', x: b().x + b().width - 3.5, y: b().y - 3.5, c: 'cursor-nesw-resize' },
                      { k: 'se', x: b().x + b().width - 3.5, y: b().y + b().height - 3.5, c: 'cursor-nwse-resize' },
                      { k: 'sw', x: b().x - 3.5, y: b().y + b().height - 3.5, c: 'cursor-nesw-resize' },
                      { k: 'n', x: b().centerX - 3.5, y: b().y - 3.5, c: 'cursor-ns-resize' },
                      { k: 's', x: b().centerX - 3.5, y: b().y + b().height - 3.5, c: 'cursor-ns-resize' },
                      { k: 'w', x: b().x - 3.5, y: b().centerY - 3.5, c: 'cursor-ew-resize' },
                      { k: 'e', x: b().x + b().width - 3.5, y: b().centerY - 3.5, c: 'cursor-ew-resize' },
                    ]}
                  >
                    {(handle) => (
                      <rect
                        x={handle.x}
                        y={handle.y}
                        width={7}
                        height={7}
                        fill="#ffffff"
                        stroke="#2d8ceb"
                        stroke-width="1.25"
                        rx={1}
                        data-handle={handle.k}
                        class={`${handle.c} pointer-events-auto`}
                      />
                    )}
                  </For>
                </Show>
              </g>
            );
          }}
        </For>
      </svg>

      {/* live coordinate HUD */}
      <Show when={hud()}>
        {(value) => (
          <div class="mf-hud" id="canvas-hud">
            <span>X: {value().x.toFixed(1)}%</span>
            <span>Y: {value().y.toFixed(1)}%</span>
            <span>
              ΔX: {value().dx >= 0 ? '+' : ''}
              {value().dx.toFixed(1)}
            </span>
          </div>
        )}
      </Show>
    </div>
  );
};
