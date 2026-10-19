import { Component, For, Show, createSignal, onMount, onCleanup, createMemo } from 'solid-js';
import { store } from '../store.js';
import type { StudioLayer } from '../types.js';

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
}

export const CanvasOverlay: Component<{ containerRef: () => HTMLDivElement | undefined; iframeRef: () => HTMLIFrameElement | undefined }> = (props) => {
  const state = store.state;

  // Interaction mode
  const [dragMode, setDragMode] = createSignal<'none' | 'move' | 'resize' | 'rotate' | 'marquee' | 'pan'>('none');
  const [resizeHandle, setResizeHandle] = createSignal<string | null>(null);
  const [activeGuides, setActiveGuides] = createSignal<SnapGuide[]>([]);
  const [marqueeRect, setMarqueeRect] = createSignal<Rect | null>(null);
  const [hoveredLayerId, setHoveredLayerId] = createSignal<string | null>(null);

  // Interaction state refs
  let dragStartScreen: Point = { x: 0, y: 0 };
  let dragStartCanvas: Point = { x: 0, y: 0 };
  let initialLayerProps: Record<string, any> = {};
  let isSpacePressed = false;

  // Logical canvas dimensions
  const canvasWidth = () => {
    const shape = state.scene?.canvas?.shape || '16:9';
    const scale = state.scene?.canvas?.scale || 1080;
    if (shape === '9:16') return Math.round((scale * 9) / 16);
    if (shape === '1:1') return scale;
    if (shape === '4:5') return Math.round((scale * 4) / 5);
    return Math.round((scale * 16) / 9);
  };

  const canvasHeight = () => {
    return state.scene?.canvas?.scale || 1080;
  };

  // Two-way coordinate transformation bridge
  const getMetrics = () => {
    const container = props.containerRef();
    const cWidth = container?.clientWidth || 1280;
    const cHeight = container?.clientHeight || 720;
    const cW = canvasWidth();
    const cH = canvasHeight();

    const fitScale = Math.min((cWidth - 40) / cW, (cHeight - 40) / cH);
    const zoom = state.viewportZoom;
    const totalScale = fitScale * zoom;

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

  // Screen px -> Canvas px
  const screenToCanvas = (screenPoint: Point): Point => {
    const m = getMetrics();
    const relX = (screenPoint.x - m.centerX) / m.totalScale;
    const relY = (screenPoint.y - m.centerY) / m.totalScale;
    return {
      x: m.cW / 2 + relX,
      y: m.cH / 2 + relY,
    };
  };

  // Canvas px -> Screen px
  const canvasToScreen = (canvasPoint: Point): Point => {
    const m = getMetrics();
    const relX = canvasPoint.x - m.cW / 2;
    const relY = canvasPoint.y - m.cH / 2;
    return {
      x: m.centerX + relX * m.totalScale,
      y: m.centerY + relY * m.totalScale,
    };
  };

  // Get layer bounds (from runtime bounds cache or calculated from spec)
  const getLayerBox = (layer: StudioLayer): Rect & { rotation: number } => {
    const cached = state.layerBounds[layer.id];
    if (cached) {
      return {
        x: cached.x,
        y: cached.y,
        width: cached.width,
        height: cached.height,
        rotation: cached.rotation || (layer as any).rotation || 0,
      };
    }

    const cW = canvasWidth();
    const cH = canvasHeight();
    const rot = (layer as any).rotation || 0;

    if (layer.type === 'background' || layer.type === 'foregroundFX') {
      return { x: 0, y: 0, width: cW, height: cH, rotation: 0 };
    }

    const pos = (layer as any).position || { xPct: 50, yPct: 50 };
    const centerX = (pos.xPct / 100) * cW;
    const centerY = (pos.yPct / 100) * cH;

    let width = 300;
    let height = 100;

    if (layer.type === 'kineticText') {
      const size = (layer as any).sizePx || 64;
      const textLen = (layer as any).text?.length || 10;
      width = Math.min(cW * 0.7, textLen * size * 0.55);
      height = size * 1.3;
    } else if (layer.type === 'card') {
      width = (layer as any).variant?.widthPx || 360;
      height = 120;
    } else if (layer.type === 'imageLogo' || layer.type === 'lottie') {
      width = (layer as any).widthPx || 200;
      height = (layer as any).heightPx || width;
    }

    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      rotation: rot,
    };
  };

  // Selected layers
  const selectedLayers = createMemo(() => {
    if (!state.scene?.layers) return [];
    const ids = state.selectedLayerIds.length > 0 ? state.selectedLayerIds : state.selectedLayerId ? [state.selectedLayerId] : [];
    return state.scene.layers.filter((l) => ids.includes(l.id));
  });

  const primarySelectedLayer = createMemo(() => {
    return selectedLayers()[0] || null;
  });

  // Calculate snap positions
  const findSnaps = (targetX: number, targetY: number, targetW: number, targetH: number, ignoreLayerId: string) => {
    if (!state.snapEnabled) return { x: targetX, y: targetY, guides: [] };

    const threshold = 6; // canvas pixels
    const guides: SnapGuide[] = [];
    const cW = canvasWidth();
    const cH = canvasHeight();

    const targetCenterX = targetX + targetW / 2;
    const targetCenterY = targetY + targetH / 2;
    const targetRight = targetX + targetW;
    const targetBottom = targetY + targetH;

    let snappedX = targetX;
    let snappedY = targetY;

    // Canvas center & edges
    const snapCandidatesX = [
      { val: 0, guide: 0, label: 'Canvas Left' },
      { val: cW / 2, guide: cW / 2, label: 'Canvas Center' },
      { val: cW, guide: cW, label: 'Canvas Right' },
    ];
    const snapCandidatesY = [
      { val: 0, guide: 0, label: 'Canvas Top' },
      { val: cH / 2, guide: cH / 2, label: 'Canvas Center' },
      { val: cH, guide: cH, label: 'Canvas Bottom' },
    ];

    // Other layers' boundaries
    if (state.scene?.layers) {
      for (const l of state.scene.layers) {
        if (l.id === ignoreLayerId || l.type === 'background' || l.type === 'foregroundFX') continue;
        const b = getLayerBox(l);
        snapCandidatesX.push({ val: b.x, guide: b.x, label: l.name || l.id });
        snapCandidatesX.push({ val: b.x + b.width / 2, guide: b.x + b.width / 2, label: l.name || l.id });
        snapCandidatesX.push({ val: b.x + b.width, guide: b.x + b.width, label: l.name || l.id });

        snapCandidatesY.push({ val: b.y, guide: b.y, label: l.name || l.id });
        snapCandidatesY.push({ val: b.y + b.height / 2, guide: b.y + b.height / 2, label: l.name || l.id });
        snapCandidatesY.push({ val: b.y + b.height, guide: b.y + b.height, label: l.name || l.id });
      }
    }

    // Check X snapping
    for (const cand of snapCandidatesX) {
      if (Math.abs(targetCenterX - cand.val) < threshold) {
        snappedX = cand.val - targetW / 2;
        guides.push({ axis: 'x', pos: cand.guide, label: cand.label });
        break;
      }
      if (Math.abs(targetX - cand.val) < threshold) {
        snappedX = cand.val;
        guides.push({ axis: 'x', pos: cand.guide, label: cand.label });
        break;
      }
      if (Math.abs(targetRight - cand.val) < threshold) {
        snappedX = cand.val - targetW;
        guides.push({ axis: 'x', pos: cand.guide, label: cand.label });
        break;
      }
    }

    // Check Y snapping
    for (const cand of snapCandidatesY) {
      if (Math.abs(targetCenterY - cand.val) < threshold) {
        snappedY = cand.val - targetH / 2;
        guides.push({ axis: 'y', pos: cand.guide, label: cand.label });
        break;
      }
      if (Math.abs(targetY - cand.val) < threshold) {
        snappedY = cand.val;
        guides.push({ axis: 'y', pos: cand.guide, label: cand.label });
        break;
      }
      if (Math.abs(targetBottom - cand.val) < threshold) {
        snappedY = cand.val - targetH;
        guides.push({ axis: 'y', pos: cand.guide, label: cand.label });
        break;
      }
    }

    return { x: snappedX, y: snappedY, guides };
  };

  // Keyboard controls for Hand tool & Zoom
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.code === 'Space' && !isSpacePressed) {
        isSpacePressed = true;
      } else if (e.key.toLowerCase() === 'h') {
        store.setActiveTool('hand');
      } else if (e.key.toLowerCase() === 'v') {
        store.setActiveTool('select');
      } else if (e.ctrlKey || e.metaKey) {
        if (e.key === '0') {
          e.preventDefault();
          store.setViewportZoom(1);
          store.setViewportPan({ x: 0, y: 0 });
        } else if (e.key === '1') {
          e.preventDefault();
          store.setViewportZoom(1);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressed = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    });
  });

  // Pointer event handlers on SVG overlay
  const handlePointerDown = (e: PointerEvent) => {
    const container = props.containerRef();
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    dragStartScreen = { x: screenX, y: screenY };
    dragStartCanvas = screenToCanvas({ x: screenX, y: screenY });

    // 1. Pan mode (Hand tool, Space+drag, or Middle mouse)
    if (state.activeTool === 'hand' || isSpacePressed || e.button === 1) {
      setDragMode('pan');
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }

    // 2. Check if clicked a resize handle
    const targetEl = e.target as HTMLElement | SVGElement;
    const handleType = targetEl.getAttribute('data-handle');
    if (handleType) {
      setResizeHandle(handleType);
      const sel = primarySelectedLayer();
      if (sel) {
        const box = getLayerBox(sel);
        initialLayerProps = {
          xPct: (sel as any).position?.xPct ?? 50,
          yPct: (sel as any).position?.yPct ?? 50,
          width: box.width,
          height: box.height,
          sizePx: (sel as any).sizePx,
          rotation: box.rotation,
        };
        store.pushHistory(`Transform layer: ${sel.name || sel.id}`);
        if (handleType === 'rotate') {
          setDragMode('rotate');
        } else {
          setDragMode('resize');
        }
      }
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }

    // 3. Check hit testing on layers (from top to bottom in z order)
    if (state.scene?.layers) {
      const clickPt = dragStartCanvas;
      const clickedLayerId = targetEl.getAttribute('data-layer-id');
      let hitLayer: StudioLayer | null = null;
      if (clickedLayerId) {
        hitLayer = state.scene.layers.find((l) => l.id === clickedLayerId) || null;
      }

      if (!hitLayer) {
        // Reverse search so topmost layer is picked
        for (let i = state.scene.layers.length - 1; i >= 0; i--) {
          const layer = state.scene.layers[i];
          if (layer.type === 'background' || layer.type === 'foregroundFX') continue;
          const box = getLayerBox(layer);

          // Simple box collision
          if (clickPt.x >= box.x && clickPt.x <= box.x + box.width && clickPt.y >= box.y && clickPt.y <= box.y + box.height) {
            hitLayer = layer;
            break;
          }
        }
      }

      if (hitLayer) {
        const isMulti = e.shiftKey;
        if (!selectedLayers().some((l) => l.id === hitLayer!.id)) {
          store.selectLayer(hitLayer.id, isMulti);
        }

        store.pushHistory(`Move layer: ${hitLayer.name || hitLayer.id}`);
        setDragMode('move');
        const box = getLayerBox(hitLayer);
        initialLayerProps = {
          layerId: hitLayer.id,
          xPct: (hitLayer as any).position?.xPct ?? 50,
          yPct: (hitLayer as any).position?.yPct ?? 50,
          boxX: box.x,
          boxY: box.y,
          boxW: box.width,
          boxH: box.height,
        };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        return;
      }
    }

    // 4. Clicked empty canvas: start marquee or deselect
    if (!e.shiftKey) {
      store.selectLayer(null);
    }
    setDragMode('marquee');
    setMarqueeRect({ x: dragStartCanvas.x, y: dragStartCanvas.y, width: 0, height: 0 });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    const container = props.containerRef();
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const currentScreen: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const currentCanvas = screenToCanvas(currentScreen);
    const mode = dragMode();

    if (mode === 'none') {
      // Hover detection
      if (state.scene?.layers && state.activeTool === 'select') {
        let hoverId: string | null = null;
        for (let i = state.scene.layers.length - 1; i >= 0; i--) {
          const l = state.scene.layers[i];
          if (l.type === 'background' || l.type === 'foregroundFX') continue;
          const box = getLayerBox(l);
          if (
            currentCanvas.x >= box.x &&
            currentCanvas.x <= box.x + box.width &&
            currentCanvas.y >= box.y &&
            currentCanvas.y <= box.y + box.height
          ) {
            hoverId = l.id;
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

      // Shift key axis lock
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }

      const layerId = initialLayerProps.layerId;
      const initBoxX = initialLayerProps.boxX;
      const initBoxY = initialLayerProps.boxY;
      const initBoxW = initialLayerProps.boxW;
      const initBoxH = initialLayerProps.boxH;

      let targetX = initBoxX + dx;
      let targetY = initBoxY + dy;

      // Smart guide snapping (unless Alt is held)
      if (!e.altKey) {
        const snap = findSnaps(targetX, targetY, initBoxW, initBoxH, layerId);
        targetX = snap.x;
        targetY = snap.y;
        setActiveGuides(snap.guides);
      } else {
        setActiveGuides([]);
      }

      const cW = canvasWidth();
      const cH = canvasHeight();
      const newCenterX = targetX + initBoxW / 2;
      const newCenterY = targetY + initBoxH / 2;

      const newXPct = Math.round((newCenterX / cW) * 1000) / 10;
      const newYPct = Math.round((newCenterY / cH) * 1000) / 10;

      // Update in store
      store.setState('scene', 'layers', (layer: StudioLayer) => layer.id === layerId, 'position', {
        xPct: newXPct,
        yPct: newYPct,
      });

      // Update runtime bounds cache synchronously
      store.setState('layerBounds', layerId, (prev) =>
        prev
          ? { ...prev, x: targetX, y: targetY }
          : { x: targetX, y: targetY, width: initBoxW, height: initBoxH, rotation: 0 }
      );

      // Dispatch ephemeral transform to preview iframe
      const iframe = props.iframeRef();
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: 'ephemeralTransform',
            layerId,
            xPct: newXPct,
            yPct: newYPct,
          },
          '*'
        );
      }
      return;
    }

    if (mode === 'resize') {
      const handle = resizeHandle();
      const sel = primarySelectedLayer();
      if (!sel || !handle) return;

      const dx = currentCanvas.x - dragStartCanvas.x;
      const dy = currentCanvas.y - dragStartCanvas.y;
      const initW = initialLayerProps.width;
      const initH = initialLayerProps.height;

      let newW = initW;
      let newH = initH;

      if (handle.includes('e')) newW = Math.max(40, initW + dx);
      if (handle.includes('w')) newW = Math.max(40, initW - dx);
      if (handle.includes('s')) newH = Math.max(20, initH + dy);
      if (handle.includes('n')) newH = Math.max(20, initH - dy);

      if (sel.type === 'kineticText') {
        const scaleFactor = Math.max(0.3, newH / initH);
        const newSize = Math.round(initialLayerProps.sizePx * scaleFactor);
        store.setState('scene', 'layers', (l: StudioLayer) => l.id === sel.id, 'sizePx', newSize);
      } else if (sel.type === 'card') {
        store.setState('scene', 'layers', (l: StudioLayer) => l.id === sel.id, 'variant', 'widthPx', Math.round(newW));
      } else if (sel.type === 'imageLogo' || sel.type === 'lottie') {
        store.setState('scene', 'layers', (l: StudioLayer) => l.id === sel.id, 'widthPx', Math.round(newW));
      }

      // Dispatch ephemeral transform to preview iframe
      const iframe = props.iframeRef();
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: 'ephemeralTransform',
            layerId: sel.id,
            widthPx: Math.round(newW),
            heightPx: Math.round(newH),
          },
          '*'
        );
      }
      return;
    }

    if (mode === 'rotate') {
      const sel = primarySelectedLayer();
      if (!sel) return;

      const box = getLayerBox(sel);
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      const angleRad = Math.atan2(currentCanvas.y - centerY, currentCanvas.x - centerX);
      let angleDeg = Math.round(angleRad * (180 / Math.PI) + 90);

      // Normalize to [-180, 180]
      while (angleDeg > 180) angleDeg -= 360;
      while (angleDeg < -180) angleDeg += 360;

      // Shift key: snap to 15-degree steps
      if (e.shiftKey) {
        angleDeg = Math.round(angleDeg / 15) * 15;
      }

      store.setState('scene', 'layers', (l: StudioLayer) => l.id === sel.id, 'rotation' as any, angleDeg);
      store.setState('layerBounds', sel.id, (prev) => (prev ? { ...prev, rotation: angleDeg } : undefined));

      // Dispatch ephemeral transform to preview iframe
      const iframe = props.iframeRef();
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: 'ephemeralTransform',
            layerId: sel.id,
            rotation: angleDeg,
          },
          '*'
        );
      }
      return;
    }

    if (mode === 'marquee') {
      const x = Math.min(dragStartCanvas.x, currentCanvas.x);
      const y = Math.min(dragStartCanvas.y, currentCanvas.y);
      const width = Math.abs(currentCanvas.x - dragStartCanvas.x);
      const height = Math.abs(currentCanvas.y - dragStartCanvas.y);
      setMarqueeRect({ x, y, width, height });
    }
  };

  const handlePointerUp = () => {
    const mode = dragMode();
    if (mode === 'move' || mode === 'resize' || mode === 'rotate') {
      store.setState('dirty', true);
      store.syncDesktopDirty();
      store.executeSave();
    } else if (mode === 'marquee' && marqueeRect()) {
      const m = marqueeRect()!;
      if (m.width > 5 && m.height > 5 && state.scene?.layers) {
        const intersected: string[] = [];
        for (const l of state.scene.layers) {
          if (l.type === 'background' || l.type === 'foregroundFX') continue;
          const box = getLayerBox(l);
          if (box.x < m.x + m.width && box.x + box.width > m.x && box.y < m.y + m.height && box.y + box.height > m.y) {
            intersected.push(l.id);
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

    setDragMode('none');
    setResizeHandle(null);
    setActiveGuides([]);
    setMarqueeRect(null);
  };

  // Wheel zoom handler
  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
      const nextZoom = Math.max(0.25, Math.min(4, Math.round((state.viewportZoom + zoomDelta) * 100) / 100));
      store.setViewportZoom(nextZoom);
    }
  };

  // Convert canvas box to screen SVG box
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

  // Drag-and-drop ingestion from Asset Vault or OS file explorer
  const [isDragOver, setIsDragOver] = createSignal(false);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (!state.scene) {
      store.addToast('Load or create a scene before dropping assets', 'warning');
      return;
    }

    const container = props.containerRef();
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const screenX = e.clientX - cRect.left;
    const screenY = e.clientY - cRect.top;

    const m = getMetrics();
    const canvasPt = screenToCanvas({ x: screenX, y: screenY });
    const xPct = Math.max(5, Math.min(95, Math.round((canvasPt.x / m.cW) * 1000) / 10));
    const yPct = Math.max(5, Math.min(95, Math.round((canvasPt.y / m.cH) * 1000) / 10));

    let assetData: { assetId?: string; kind?: string; src?: string; name?: string } | null = null;
    const jsonStr = e.dataTransfer?.getData('application/json');
    if (jsonStr) {
      try {
        assetData = JSON.parse(jsonStr);
      } catch {}
    }
    if (!assetData) {
      const textId = e.dataTransfer?.getData('text/plain');
      if (textId) {
        const found = state.scene.assets?.find((a) => a.id === textId);
        if (found) {
          assetData = { assetId: found.id, kind: found.kind, src: found.src, name: found.name };
        } else {
          assetData = { assetId: textId };
        }
      }
    }

    // Check for native OS file drop (image file from desktop explorer)
    if (!assetData && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (readEvt) => {
          const dataUrl = readEvt.target?.result as string;
          const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
          const assetId = `img_${cleanName}_${Math.random().toString(36).slice(2, 6)}`;
          const layerId = `layer_${cleanName}_${Math.random().toString(36).slice(2, 6)}`;

          store.mutateScene((sc) => {
            if (!sc.assets) sc.assets = [];
            sc.assets.push({
              id: assetId,
              kind: 'image',
              src: dataUrl,
              name: file.name,
            });
            sc.layers.push({
              id: layerId,
              name: file.name,
              type: 'imageLogo',
              assetId: assetId,
              widthPx: 300,
              position: { xPct, yPct },
              at: state.playhead,
              duration: 3000,
            });
          }, `Dropped image file ${file.name}`);

          store.selectLayer(layerId);
          store.executeSave();
        };
        reader.readAsDataURL(file);
        return;
      }
    }

    if (!assetData) {
      store.addToast('Unrecognized asset dropped onto canvas', 'warning');
      return;
    }

    const assetId = assetData.assetId || 'logo';
    const kind = assetData.kind || 'image';
    const newLayerId = `${kind}-${Math.random().toString(36).slice(2, 7)}`;

    store.mutateScene((sc) => {
      if (!sc.assets) sc.assets = [];
      if (!sc.assets.some((a) => a.id === assetId)) {
        sc.assets.push({
          id: assetId,
          kind: (kind as any) || 'image',
          src: assetData?.src || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iNDAiIGZpbGw9IiNmNTllMGIiLz48L3N2Zz4=',
          name: assetData?.name || assetId,
        });
      }

      if (kind === 'audio') {
        if (!sc.audio) sc.audio = { cues: [] };
        if (!sc.audio.cues) sc.audio.cues = [];
        const validSfx = ['whoosh', 'pop', 'click', 'subImpact', 'shimmer', 'riser'];
        const sfxName = validSfx.includes(assetId) ? assetId : 'pop';
        sc.audio.cues.push({
          id: `cue-${Math.random().toString(36).slice(2, 7)}`,
          at: state.playhead,
          sfx: sfxName as any,
          gain: 1,
          pan: 0,
        });
        store.addToast(`Added audio cue at ${state.playhead}ms`, 'success');
      } else if (kind === 'lottie') {
        sc.layers.push({
          id: newLayerId,
          name: assetData?.name || `Lottie ${assetId}`,
          type: 'lottie',
          assetId,
          position: { xPct, yPct },
          at: state.playhead,
          duration: 3000,
        });
        store.selectLayer(newLayerId);
        store.addToast(`Created Lottie layer at (${xPct}%, ${yPct}%)`, 'success');
      } else {
        sc.layers.push({
          id: newLayerId,
          name: assetData?.name || `Image ${assetId}`,
          type: 'imageLogo',
          assetId,
          widthPx: 300,
          position: { xPct, yPct },
          at: state.playhead,
          duration: 3000,
        });
        store.selectLayer(newLayerId);
        store.addToast(`Created Image layer at (${xPct}%, ${yPct}%)`, 'success');
      }
    }, `Dropped asset ${assetId} onto canvas`);

    store.executeSave();
  };

  const cursorClass = () => {
    if (state.activeTool === 'hand' || isSpacePressed) {
      return dragMode() === 'pan' ? 'cursor-grabbing' : 'cursor-grab';
    }
    return 'cursor-default';
  };

  return (
    <div
      id="canvas-overlay-container"
      class={`absolute inset-0 select-none ${cursorClass()} ${
        isDragOver() ? 'ring-2 ring-[#f59e0b] bg-[#f59e0b]/5' : ''
      }`}
      style={{ 'pointer-events': 'auto' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* DRAG-OVER DROP ZONE OVERLAY HINT */}
      <Show when={isDragOver()}>
        <div class="absolute inset-4 rounded-xl border-2 border-dashed border-[#f59e0b] bg-[#f59e0b]/10 pointer-events-none flex items-center justify-center z-40 backdrop-blur-[2px]">
          <div class="px-4 py-2 rounded-lg bg-[#14141c]/90 border border-[#f59e0b] text-[#f59e0b] font-medium text-sm flex items-center gap-2 shadow-2xl">
            <span>✨</span>
            <span>Drop Asset onto Canvas to Position</span>
          </div>
        </div>
      </Show>

      <svg class="w-full h-full overflow-visible pointer-events-none">
        {/* SNAP GUIDES */}
        <For each={activeGuides()}>
          {(guide) => {
            if (guide.axis === 'x') {
              const pt = canvasToScreen({ x: guide.pos, y: 0 });
              return (
                <line
                  x1={pt.x}
                  y1={0}
                  x2={pt.x}
                  y2="100%"
                  stroke="#22d3ee"
                  stroke-width="1.5"
                  stroke-dasharray="4 4"
                />
              );
            } else {
              const pt = canvasToScreen({ x: 0, y: guide.pos });
              return (
                <line
                  x1={0}
                  y1={pt.y}
                  x2="100%"
                  y2={pt.y}
                  stroke="#22d3ee"
                  stroke-width="1.5"
                  stroke-dasharray="4 4"
                />
              );
            }
          }}
        </For>

        {/* MARQUEE SELECTION BOX */}
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
                fill="rgba(34, 211, 238, 0.12)"
                stroke="#22d3ee"
                stroke-width="1"
                stroke-dasharray="3 3"
              />
            );
          })()}
        </Show>

        {/* HOVERED LAYER OUTLINE (if not selected) */}
        <Show
          when={
            hoveredLayerId() &&
            !selectedLayers().some((l) => l.id === hoveredLayerId()) &&
            state.scene?.layers
          }
        >
          {(() => {
            const l = state.scene!.layers.find((x) => x.id === hoveredLayerId());
            if (!l) return null;
            const b = getScreenBox(getLayerBox(l));
            return (
              <g transform={`rotate(${b.rotation} ${b.centerX} ${b.centerY})`}>
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.width}
                  height={b.height}
                  fill="none"
                  stroke="rgba(245, 158, 11, 0.45)"
                  stroke-width="1"
                  stroke-dasharray="3 3"
                />
              </g>
            );
          })()}
        </Show>

        {/* SELECTED LAYERS BOUNDING BOXES & HANDLES */}
        <For each={selectedLayers()}>
          {(layer) => {
            const b = createMemo(() => getScreenBox(getLayerBox(layer)));
            const isPrimary = createMemo(() => primarySelectedLayer()?.id === layer.id);

            return (
              <g transform={`rotate(${b().rotation} ${b().centerX} ${b().centerY})`}>
                {/* BOUNDING RECTANGLE */}
                <rect
                  id="selection-bounding-box"
                  data-layer-id={layer.id}
                  x={b().x}
                  y={b().y}
                  width={b().width}
                  height={b().height}
                  fill="rgba(245, 158, 11, 0.05)"
                  stroke="#f59e0b"
                  stroke-width="1.5"
                  class="cursor-move pointer-events-auto"
                />

                {/* 8 RESIZE HANDLES & 1 ROTATION HANDLE (ON PRIMARY SELECTION) */}
                <Show when={isPrimary()}>
                  {/* ROTATION STEM & HANDLE (18px above top-center) */}
                  <line
                    x1={b().centerX}
                    y1={b().y}
                    x2={b().centerX}
                    y2={b().y - 18}
                    stroke="#f59e0b"
                    stroke-width="1.5"
                  />
                  <circle
                    cx={b().centerX}
                    cy={b().y - 18}
                    r={4.5}
                    fill="#f59e0b"
                    stroke="#ffffff"
                    stroke-width="1.5"
                    data-handle="rotate"
                    class="cursor-crosshair pointer-events-auto"
                  />

                  {/* 4 CORNER RESIZE HANDLES */}
                  <rect
                    x={b().x - 4}
                    y={b().y - 4}
                    width={8}
                    height={8}
                    fill="#ffffff"
                    stroke="#f59e0b"
                    stroke-width="1.5"
                    rx={1}
                    data-handle="nw"
                    class="cursor-nwse-resize pointer-events-auto"
                  />
                  <rect
                    x={b().x + b().width - 4}
                    y={b().y - 4}
                    width={8}
                    height={8}
                    fill="#ffffff"
                    stroke="#f59e0b"
                    stroke-width="1.5"
                    rx={1}
                    data-handle="ne"
                    class="cursor-nesw-resize pointer-events-auto"
                  />
                  <rect
                    x={b().x + b().width - 4}
                    y={b().y + b().height - 4}
                    width={8}
                    height={8}
                    fill="#ffffff"
                    stroke="#f59e0b"
                    stroke-width="1.5"
                    rx={1}
                    data-handle="se"
                    class="cursor-nwse-resize pointer-events-auto"
                  />
                  <rect
                    x={b().x - 4}
                    y={b().y + b().height - 4}
                    width={8}
                    height={8}
                    fill="#ffffff"
                    stroke="#f59e0b"
                    stroke-width="1.5"
                    rx={1}
                    data-handle="sw"
                    class="cursor-nesw-resize pointer-events-auto"
                  />

                  {/* 4 EDGE RESIZE HANDLES */}
                  <rect
                    x={b().centerX - 4}
                    y={b().y - 4}
                    width={8}
                    height={8}
                    fill="#ffffff"
                    stroke="#f59e0b"
                    stroke-width="1.5"
                    rx={1}
                    data-handle="n"
                    class="cursor-ns-resize pointer-events-auto"
                  />
                  <rect
                    x={b().x + b().width - 4}
                    y={b().centerY - 4}
                    width={8}
                    height={8}
                    fill="#ffffff"
                    stroke="#f59e0b"
                    stroke-width="1.5"
                    rx={1}
                    data-handle="e"
                    class="cursor-ew-resize pointer-events-auto"
                  />
                  <rect
                    x={b().centerX - 4}
                    y={b().y + b().height - 4}
                    width={8}
                    height={8}
                    fill="#ffffff"
                    stroke="#f59e0b"
                    stroke-width="1.5"
                    rx={1}
                    data-handle="s"
                    class="cursor-ns-resize pointer-events-auto"
                  />
                  <rect
                    x={b().x - 4}
                    y={b().centerY - 4}
                    width={8}
                    height={8}
                    fill="#ffffff"
                    stroke="#f59e0b"
                    stroke-width="1.5"
                    rx={1}
                    data-handle="w"
                    class="cursor-ew-resize pointer-events-auto"
                  />
                </Show>
              </g>
            );
          }}
        </For>
      </svg>

      {/* VIEWPORT CONTROLS FLOATING TOOLBAR */}
      <div class="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1 bg-[#14141c]/90 backdrop-blur-md border border-[#2a2a38] rounded-md shadow-lg text-xs text-[#a1a1aa] z-30">
        <button
          class={`px-2 py-0.5 rounded font-mono ${state.activeTool === 'select' ? 'bg-[#f59e0b]/20 text-[#f59e0b] font-bold' : 'hover:text-white'}`}
          title="Selection Tool (V)"
          onClick={() => store.setActiveTool('select')}
        >
          V
        </button>
        <button
          class={`px-2 py-0.5 rounded font-mono ${state.activeTool === 'hand' ? 'bg-[#f59e0b]/20 text-[#f59e0b] font-bold' : 'hover:text-white'}`}
          title="Hand Tool (H / Space+Drag)"
          onClick={() => store.setActiveTool('hand')}
        >
          H
        </button>
        <div class="w-px h-3.5 bg-[#2a2a38] mx-0.5" />
        <select
          class="bg-transparent border-none text-xs text-[#e4e4e7] focus:outline-none cursor-pointer"
          value={state.viewportZoom}
          onChange={(e) => store.setViewportZoom(Number(e.currentTarget.value))}
        >
          <option value="0.25">25%</option>
          <option value="0.5">50%</option>
          <option value="0.75">75%</option>
          <option value="1">100%</option>
          <option value="1.5">150%</option>
          <option value="2">200%</option>
          <option value="4">400%</option>
        </select>
        <button
          class="px-1.5 py-0.5 hover:text-white text-[11px]"
          title="Fit Viewport (Ctrl+0)"
          onClick={() => {
            store.setViewportZoom(1);
            store.setViewportPan({ x: 0, y: 0 });
          }}
        >
          Fit
        </button>
        <div class="w-px h-3.5 bg-[#2a2a38] mx-0.5" />
        <button
          class={`px-1.5 py-0.5 rounded text-[11px] font-mono ${state.snapEnabled ? 'text-[#22d3ee]' : 'text-[#71717a]'}`}
          title="Toggle Snapping"
          onClick={() => store.setState('snapEnabled', !state.snapEnabled)}
        >
          SNAP: {state.snapEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
};
