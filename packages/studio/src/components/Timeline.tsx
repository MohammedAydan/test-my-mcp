import { Component, For, Show, onMount, onCleanup, createEffect, createSignal, createMemo } from 'solid-js';
import { store } from '../store.js';
import { getLayerColor } from './LayersPanel.js';
import type { StudioLayer } from '../types.js';

const RULER_H = 28;
const TRACK_H = 28;
const SUBTRACK_H = 22;
const TRACK_GAP = 4;
const TRACK_HEADER_W = 220;

export const Timeline: Component = () => {
  const state = store.state;
  let canvasRef: HTMLCanvasElement | undefined;
  let tracksScrollRef: HTMLDivElement | undefined;
  let verticalScrollbarRef: HTMLDivElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;

  const onTracksScroll = (e: Event) => {
    const target = e.currentTarget as HTMLElement;
    if (Math.abs(state.timelineScrollY - target.scrollTop) > 0.5) {
      store.setTimelineScrollY(target.scrollTop);
    }
  };

  const onVerticalScrollbarScroll = (e: Event) => {
    const target = e.currentTarget as HTMLElement;
    if (Math.abs(state.timelineScrollY - target.scrollTop) > 0.5) {
      store.setTimelineScrollY(target.scrollTop);
    }
  };

  // Interaction state
  let isDraggingPlayhead = false;
  let isPanning = false;
  let panStartX = 0;
  let initialPanOffset = 0;

  let dragMode: 'move' | 'trim-left' | 'trim-right' | 'keyframe' | null = null;
  let dragLayer: StudioLayer | null = null;
  let dragStartMouseX = 0;
  let dragInitialAt = 0;
  let dragInitialDuration = 0;
  let dragKeyframeInfo: { layerId: string; property: string; index: number; initialAt: number } | null = null;
  let hasDragged = false;
  const edgeHoverZone = 6;

  // Standard keyframable properties per layer type
  const getLayerAnimatableProps = (layer: StudioLayer): string[] => {
    const common = ['position.xPct', 'position.yPct', 'rotation', 'opacity', 'scale'];
    if (layer.type === 'kineticText') return [...common, 'sizePx'];
    if (layer.type === 'card') return [...common, 'widthPx'];
    if (layer.type === 'imageLogo' || layer.type === 'lottie') return [...common, 'widthPx', 'heightPx'];
    return common;
  };

  const totalDuration = () => state.scene?.durationMs || 10000;

  const timeToX = (ms: number) => {
    if (!canvasRef) return 0;
    const w = canvasRef.clientWidth;
    const pxPerMs = (w * state.zoom) / totalDuration();
    return ms * pxPerMs + state.panOffset;
  };

  const xToTime = (x: number) => {
    if (!canvasRef) return 0;
    const w = canvasRef.clientWidth;
    const pxPerMs = (w * state.zoom) / totalDuration();
    const rawMs = (x - state.panOffset) / pxPerMs;

    if (!state.snapEnabled) {
      return Math.max(0, Math.min(rawMs, totalDuration()));
    }

    let snapped = Math.round(rawMs / 100) * 100;
    const snapThresholdMs = 12 / pxPerMs;
    const layers = state.scene?.layers || [];

    // Snap to playhead, In/Out, layer boundaries, and keyframes
    const candidates = [
      state.playhead,
      state.inPoint ?? -1,
      state.outPoint ?? -1,
      0,
      totalDuration(),
    ];

    for (const l of layers) {
      candidates.push(l.at || 0);
      candidates.push((l.at || 0) + (l.duration || 3000));
      if (l.tracks) {
        for (const tr of l.tracks as any[]) {
          if (tr.keyframes) {
            for (const kf of tr.keyframes) candidates.push(kf.at);
          }
        }
      }
    }

    for (const cand of candidates) {
      if (cand >= 0 && Math.abs(rawMs - cand) < snapThresholdMs) {
        snapped = cand;
        break;
      }
    }

    return Math.max(0, Math.min(snapped, totalDuration()));
  };

  const calcTickMs = (visibleMs: number) => {
    if (visibleMs <= 1000) return 100;
    if (visibleMs <= 2500) return 250;
    if (visibleMs <= 5000) return 500;
    if (visibleMs <= 10000) return 1000;
    if (visibleMs <= 30000) return 2000;
    return 5000;
  };

  // Group layers into logical Track Lanes (supporting explicit trackIndex & trackLane)
  const getTrackLanes = () => {
    const layers = state.scene?.layers || [];
    const declaredLanes = ((state.scene as any)?.trackLanes || []) as Array<{
      id?: string;
      index?: number;
      name?: string;
      kind?: 'video' | 'audio' | 'overlay' | 'general';
      locked?: boolean;
      muted?: boolean;
    }>;

    const tracksMap = new Map<
      number,
      {
        id?: string;
        index: number;
        name: string;
        kind: 'video' | 'audio' | 'overlay' | 'general';
        layers: StudioLayer[];
        y: number;
        h: number;
        locked?: boolean;
        muted?: boolean;
      }
    >();

    const idToIndexMap = new Map<string, number>();

    declaredLanes.forEach((dl, i) => {
      const idx = typeof dl.index === 'number' ? dl.index : i;
      if (dl.id) {
        idToIndexMap.set(dl.id, idx);
      }
      tracksMap.set(idx, {
        id: dl.id,
        index: idx,
        name: dl.name || `Track ${idx + 1}`,
        kind: dl.kind || 'general',
        layers: [],
        y: 0,
        h: TRACK_H,
        locked: dl.locked,
        muted: dl.muted,
      });
    });

    const explicitIndices = new Set<number>();
    for (const l of layers) {
      const explicitIdx = (l as any).trackIndex;
      const explicitLane = (l as any).trackLane;
      if (typeof explicitIdx === 'number') {
        explicitIndices.add(explicitIdx);
      } else if (typeof explicitLane === 'string' && idToIndexMap.has(explicitLane)) {
        explicitIndices.add(idToIndexMap.get(explicitLane)!);
      }
    }

    let nextAutoIndex = 0;
    const findNextFreeIndex = () => {
      while (tracksMap.has(nextAutoIndex) || explicitIndices.has(nextAutoIndex)) {
        nextAutoIndex++;
      }
      return nextAutoIndex++;
    };

    for (const layer of layers) {
      const explicitIdx = (layer as any).trackIndex;
      const explicitLane = (layer as any).trackLane;
      let targetIdx: number;

      if (typeof explicitIdx === 'number') {
        targetIdx = explicitIdx;
      } else if (typeof explicitLane === 'string' && idToIndexMap.has(explicitLane)) {
        targetIdx = idToIndexMap.get(explicitLane)!;
      } else {
        targetIdx = findNextFreeIndex();
      }

      if (!tracksMap.has(targetIdx)) {
        tracksMap.set(targetIdx, {
          index: targetIdx,
          name: `Track ${targetIdx + 1}`,
          kind: 'general',
          layers: [],
          y: 0,
          h: TRACK_H,
        });
      }

      tracksMap.get(targetIdx)!.layers.push(layer);
    }

    const sortedTracks = Array.from(tracksMap.values()).sort((a, b) => a.index - b.index);

    for (const t of sortedTracks) {
      t.layers.sort((a, b) => (a.at || 0) - (b.at || 0));
    }

    return sortedTracks;
  };

  const computedTracks = createMemo(() => getTrackLanes());

  // Compute row layout heights for multi-track canvas
  const computeTrackLayout = () => {
    const tracks = computedTracks();
    let currentY = RULER_H + 4;
    const layout: Array<{
      layer: StudioLayer;
      trackIndex: number;
      y: number;
      h: number;
      subtracks: Array<{ property: string; y: number; h: number }>;
    }> = [];

    for (const track of tracks) {
      track.y = currentY;
      track.h = TRACK_H;

      let maxSubtracksH = 0;

      for (const layer of track.layers) {
        const isExpanded = state.expandedLayerIds.includes(layer.id);
        const props = isExpanded ? getLayerAnimatableProps(layer) : [];
        const subtracks = props.map((property, idx) => ({
          property,
          y: currentY + TRACK_H + idx * SUBTRACK_H,
          h: SUBTRACK_H,
        }));

        if (subtracks.length * SUBTRACK_H > maxSubtracksH) {
          maxSubtracksH = subtracks.length * SUBTRACK_H;
        }

        layout.push({
          layer,
          trackIndex: track.index,
          y: currentY,
          h: TRACK_H,
          subtracks,
        });
      }

      currentY += TRACK_H + maxSubtracksH + TRACK_GAP;
    }

    return { tracks, layout, totalHeight: currentY + 40 };
  };

  // Main Canvas Rendering Loop
  const draw = () => {
    if (!canvasRef || !ctx) return;
    const w = canvasRef.clientWidth;
    const h = canvasRef.clientHeight;

    ctx.clearRect(0, 0, w, h);

    // 1. Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    const dur = totalDuration();
    const { tracks, layout } = computeTrackLayout();

    // 2. In / Out Marks shaded regions
    if (state.inPoint !== null && state.inPoint > 0) {
      const inX = timeToX(state.inPoint);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, RULER_H, inX, h - RULER_H);
    }
    if (state.outPoint !== null && state.outPoint < dur) {
      const outX = timeToX(state.outPoint);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(outX, RULER_H, w - outX, h - RULER_H);
    }

    // 3. Track Rows & Keyframes (clipped below ruler and translated by timelineScrollY)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_H, w, Math.max(0, h - RULER_H));
    ctx.clip();
    ctx.translate(0, -state.timelineScrollY);

    // Track background lanes
    for (const track of tracks) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.fillRect(0, track.y, w, track.h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.moveTo(0, track.y + track.h);
      ctx.lineTo(w, track.y + track.h);
      ctx.stroke();
    }

    for (const item of layout) {
      const layer = item.layer;
      const x1 = timeToX(layer.at || 0);
      const layerDur = layer.duration || dur - (layer.at || 0);
      const x2 = timeToX((layer.at || 0) + layerDur);
      const barW = Math.max(4, x2 - x1);

      const isSelected =
        state.selectedLayerIds.includes(layer.id) || state.selectedLayerId === layer.id;
      const baseColor = getLayerColor(layer.type);

      // Main Layer bar
      ctx.fillStyle = isSelected ? baseColor : 'rgba(255, 255, 255, 0.09)';
      ctx.fillRect(x1, item.y, barW, item.h - 2);

      // Entrance / Exit Preset Hatch overlay
      if (layer.entrance && barW > 40) {
        const entDur = (layer.entrance as any).durationMs || 600;
        const entW = Math.min(barW / 2, timeToX((layer.at || 0) + entDur) - x1);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
        ctx.fillRect(x1, item.y, entW, item.h - 2);
      }
      if (layer.exit && barW > 40) {
        const exitDur = (layer.exit as any).durationMs || 400;
        const exitW = Math.min(barW / 2, x2 - timeToX((layer.at || 0) + layerDur - exitDur));
        ctx.fillStyle = 'rgba(244, 63, 94, 0.2)';
        ctx.fillRect(x2 - exitW, item.y, exitW, item.h - 2);
      }

      // Border & selection
      ctx.strokeStyle = isSelected ? '#f59e0b' : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.strokeRect(x1, item.y, barW, item.h - 2);

      // Trim Handle indicators on edges
      if (isSelected && barW > 20) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x1 + 1, item.y + 4, 2, item.h - 10);
        ctx.fillRect(x2 - 3, item.y + 4, 2, item.h - 10);
      }

      // Layer bar label
      if (barW > 35) {
        ctx.fillStyle = isSelected ? '#0a0a0f' : '#f1f5f9';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(layer.name || layer.id, x1 + 8, item.y + (item.h - 2) / 2);
      }

      // Property Sub-tracks & Diamond Keyframe Markers
      for (const sub of item.subtracks) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, sub.y, w, sub.h);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.strokeRect(0, sub.y, w, sub.h);

        // Find track in layer
        const track = (layer.tracks as any[])?.find((t) => t.property === sub.property);
        if (track && track.keyframes) {
          track.keyframes.forEach((kf: any, kfIdx: number) => {
            const kfX = timeToX(kf.at);
            const kfY = sub.y + sub.h / 2;
            const isKfSelected =
              state.selectedKeyframe?.layerId === layer.id &&
              state.selectedKeyframe?.property === sub.property &&
              state.selectedKeyframe?.index === kfIdx;

            // Render Diamond marker
            ctx!.save();
            ctx!.translate(kfX, kfY);
            ctx!.rotate(Math.PI / 4);
            ctx!.fillStyle = isKfSelected ? '#ffffff' : '#f59e0b';
            ctx!.fillRect(-4.5, -4.5, 9, 9);
            ctx!.strokeStyle = isKfSelected ? '#f59e0b' : '#0a0a0f';
            ctx!.lineWidth = 1.5;
            ctx!.strokeRect(-4.5, -4.5, 9, 9);
            ctx!.restore();
          });
        }
      }
    }
    ctx.restore();

    // 4. Ruler Header (pinned on top)
    ctx.fillStyle = '#101017';
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, RULER_H - 1, w, 1);

    const tickMs = calcTickMs(dur / state.zoom);
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textBaseline = 'middle';

    const startVisibleMs = Math.max(0, xToTime(0));
    const endVisibleMs = Math.min(dur, xToTime(w));
    const firstTick = Math.floor(startVisibleMs / tickMs) * tickMs;

    for (let t = firstTick; t <= endVisibleMs + tickMs; t += tickMs) {
      const x = timeToX(t);
      if (x < -50 || x > w + 50) continue;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(x, RULER_H - 8, 1, 8);

      ctx.fillStyle = '#a1a1aa';
      ctx.fillText(`${(t / 1000).toFixed(1)}s`, x + 4, RULER_H / 2);
    }

    // In / Out Marker brackets in Ruler
    if (state.inPoint !== null) {
      const inX = timeToX(state.inPoint);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(inX - 1, 0, 3, RULER_H);
      ctx.fillRect(inX, RULER_H - 4, 8, 4);
    }
    if (state.outPoint !== null) {
      const outX = timeToX(state.outPoint);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(outX - 2, 0, 3, RULER_H);
      ctx.fillRect(outX - 8, RULER_H - 4, 8, 4);
    }

    // 5. Playhead Line & Scrubber Needle
    const playheadX = timeToX(state.playhead);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, h);
    ctx.stroke();

    // Needle head in ruler
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, 0);
    ctx.lineTo(playheadX + 6, 0);
    ctx.lineTo(playheadX + 6, RULER_H - 6);
    ctx.lineTo(playheadX, RULER_H);
    ctx.lineTo(playheadX - 6, RULER_H - 6);
    ctx.closePath();
    ctx.fill();
  };

  createEffect(() => {
    state.playhead;
    state.zoom;
    state.panOffset;
    state.timelineScrollY;
    state.scene;
    state.selectedLayerId;
    state.selectedLayerIds.length;
    state.expandedLayerIds.length;
    state.selectedKeyframe;
    state.inPoint;
    state.outPoint;
    requestAnimationFrame(draw);
  });

  createEffect(() => {
    const scrollY = state.timelineScrollY;
    if (tracksScrollRef && Math.abs(tracksScrollRef.scrollTop - scrollY) > 0.5) {
      tracksScrollRef.scrollTop = scrollY;
    }
    if (verticalScrollbarRef && Math.abs(verticalScrollbarRef.scrollTop - scrollY) > 0.5) {
      verticalScrollbarRef.scrollTop = scrollY;
    }
  });

  const resize = () => {
    if (!canvasRef) return;
    const rect = canvasRef.parentElement?.getBoundingClientRect();
    if (!rect) return;
    canvasRef.width = rect.width * window.devicePixelRatio;
    canvasRef.height = rect.height * window.devicePixelRatio;
    ctx = canvasRef.getContext('2d');
    ctx?.scale(window.devicePixelRatio, window.devicePixelRatio);
    draw();
  };

  onMount(() => {
    resize();
    window.addEventListener('resize', resize);

    // Global JKL Transport & Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      const key = e.key.toLowerCase();

      // JKL Transport loop
      if (key === 'l') {
        let rate = 1;
        if (state.playing && state.playbackRate >= 1) {
          rate = state.playbackRate === 1 ? 2 : state.playbackRate === 2 ? 4 : 1;
        }
        store.setPlaybackRate(rate);
        store.setPlaying(true);
      } else if (key === 'k') {
        store.setPlaying(false);
        store.setPlaybackRate(1);
      } else if (key === 'j') {
        let rate = -1;
        if (state.playing && state.playbackRate <= -1) {
          rate = state.playbackRate === -1 ? -2 : state.playbackRate === -2 ? -4 : -1;
        }
        store.setPlaybackRate(rate);
        store.setPlaying(true);
      } else if (key === 'i') {
        store.setInPoint(state.playhead);
        store.addToast(`In-point set to ${state.playhead}ms`, 'info');
      } else if (key === 'o') {
        store.setOutPoint(state.playhead);
        store.addToast(`Out-point set to ${state.playhead}ms`, 'info');
      } else if (key === 'x') {
        const sel = state.scene?.layers?.find((l) => l.id === state.selectedLayerId);
        if (sel) {
          const at = sel.at || 0;
          const dur = sel.duration || (totalDuration() - at);
          store.setInPoint(at);
          store.setOutPoint(at + dur);
        }
      } else if ((e.ctrlKey || e.metaKey) && key === 'k') {
        e.preventDefault();
        store.razorSplitAtPlayhead();
      } else if (e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        store.rippleDeleteSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedKeyframe) {
          e.preventDefault();
          store.deleteKeyframe(
            state.selectedKeyframe.layerId,
            state.selectedKeyframe.property,
            state.selectedKeyframe.index
          );
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        store.setPlayhead(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        store.setPlayhead(totalDuration());
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? 1000 : 33;
        store.setPlayhead(state.playhead - step);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1000 : 33;
        store.setPlayhead(state.playhead + step);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Mouse handlers on canvas
    const onMouseDown = (e: MouseEvent) => {
      if (!canvasRef) return;
      const rect = canvasRef.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // 1. Click in Ruler -> seek playhead
      if (y <= RULER_H) {
        isDraggingPlayhead = true;
        store.setPlayhead(xToTime(x));
        return;
      }

      // 2. Middle click -> pan timeline
      if (e.button === 1 || e.altKey) {
        isPanning = true;
        panStartX = e.clientX;
        initialPanOffset = state.panOffset;
        return;
      }

      // 3. Check hit testing on keyframes and layer bars
      const unshiftedY = y + state.timelineScrollY;
      const { layout } = computeTrackLayout();

      for (const item of layout) {
        const layer = item.layer;
        const x1 = timeToX(layer.at || 0);
        const layerDur = layer.duration || totalDuration() - (layer.at || 0);
        const x2 = timeToX((layer.at || 0) + layerDur);

        // Check keyframe diamond hits in property sub-tracks
        for (const sub of item.subtracks) {
          if (unshiftedY >= sub.y && unshiftedY <= sub.y + sub.h) {
            const track = (layer.tracks as any[])?.find((t) => t.property === sub.property);
            if (track && track.keyframes) {
              for (let kfIdx = 0; kfIdx < track.keyframes.length; kfIdx++) {
                const kf = track.keyframes[kfIdx];
                const kfX = timeToX(kf.at);
                if (Math.abs(x - kfX) < 8) {
                  store.setSelectedKeyframe({ layerId: layer.id, property: sub.property, index: kfIdx });
                  hasDragged = false;
                  dragMode = 'keyframe';
                  dragKeyframeInfo = {
                    layerId: layer.id,
                    property: sub.property,
                    index: kfIdx,
                    initialAt: kf.at,
                  };
                  dragStartMouseX = e.clientX;
                  return;
                }
              }
            }
          }
        }

        // Check layer bar hit
        if (unshiftedY >= item.y && unshiftedY <= item.y + item.h) {
          if (x >= x1 - edgeHoverZone && x <= x2 + edgeHoverZone) {
            const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
            store.selectLayer(layer.id, isMulti);

            hasDragged = false;
            dragLayer = layer;
            dragStartMouseX = e.clientX;
            dragInitialAt = layer.at || 0;
            dragInitialDuration = layer.duration || totalDuration() - dragInitialAt;

            // Trim left edge
            if (Math.abs(x - x1) <= edgeHoverZone) {
              dragMode = 'trim-left';
            }
            // Trim right edge
            else if (Math.abs(x - x2) <= edgeHoverZone) {
              dragMode = 'trim-right';
            }
            // Move layer
            else {
              dragMode = 'move';
            }
            return;
          }
        }
      }

      // 4. Click empty area -> seek playhead
      store.setPlayhead(xToTime(x));
      isDraggingPlayhead = true;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!canvasRef) return;
      const rect = canvasRef.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (isDraggingPlayhead) {
        store.setPlayhead(xToTime(x));
        return;
      }

      if (isPanning) {
        const dx = e.clientX - panStartX;
        store.setPanOffset(initialPanOffset + dx);
        return;
      }

      if (dragMode && dragLayer) {
        const dx = e.clientX - dragStartMouseX;

        if (!hasDragged) {
          if (Math.abs(dx) < 2) return;
          hasDragged = true;
          store.pushHistory(`Timeline edit: ${dragMode}`);
        }

        const w = canvasRef.clientWidth;
        const pxPerMs = (w * state.zoom) / totalDuration();
        const deltaMs = Math.round(dx / pxPerMs);

        // Find track and neighboring clips on the same track to prevent collisions
        const tracks = computedTracks();
        const currentTrack = tracks.find((t) => t.layers.some((l) => l.id === dragLayer!.id));
        let minBoundaryAt = 0;
        let maxBoundaryEnd = totalDuration();

        if (currentTrack) {
          for (const other of currentTrack.layers) {
            if (other.id === dragLayer.id) continue;
            const otherAt = other.at || 0;
            const otherDur = other.duration ?? (totalDuration() - otherAt);
            const otherEnd = otherAt + otherDur;

            if (otherAt < dragInitialAt) {
              if (otherEnd > minBoundaryAt) {
                minBoundaryAt = otherEnd;
              }
            } else if (otherAt > dragInitialAt) {
              if (otherAt < maxBoundaryEnd) {
                maxBoundaryEnd = otherAt;
              }
            }
          }
        }

        if (dragMode === 'move') {
          const maxAllowedAt = Math.max(minBoundaryAt, maxBoundaryEnd - dragInitialDuration);
          const requestedAt = dragInitialAt + deltaMs;
          const newAt = Math.max(minBoundaryAt, Math.min(maxAllowedAt, requestedAt));
          store.setState('scene', 'layers', (l: StudioLayer) => l.id === dragLayer!.id, 'at', newAt);
        } else if (dragMode === 'trim-left') {
          const maxAllowedAt = (dragInitialAt + dragInitialDuration) - 200;
          const requestedAt = dragInitialAt + deltaMs;
          const newAt = Math.max(minBoundaryAt, Math.min(maxAllowedAt, requestedAt));
          const newDur = (dragInitialAt + dragInitialDuration) - newAt;
          store.setState('scene', 'layers', (l: StudioLayer) => l.id === dragLayer!.id, {
            at: newAt,
            duration: newDur,
          });
        } else if (dragMode === 'trim-right') {
          const maxAllowedDur = Math.max(200, maxBoundaryEnd - dragInitialAt);
          const requestedDur = dragInitialDuration + deltaMs;
          const newDur = Math.max(200, Math.min(maxAllowedDur, requestedDur));
          store.setState('scene', 'layers', (l: StudioLayer) => l.id === dragLayer!.id, 'duration', newDur);
        }
        return;
      }

      if (dragMode === 'keyframe' && dragKeyframeInfo) {
        const dx = e.clientX - dragStartMouseX;

        if (!hasDragged) {
          if (Math.abs(dx) < 2) return;
          hasDragged = true;
          store.pushHistory('Timeline edit: keyframe');
        }

        const w = canvasRef.clientWidth;
        const pxPerMs = (w * state.zoom) / totalDuration();
        const deltaMs = Math.round(dx / pxPerMs);
        const newAt = Math.max(0, Math.min(totalDuration(), dragKeyframeInfo.initialAt + deltaMs));

        store.setState(
          'scene',
          'layers',
          (l: StudioLayer) => l.id === dragKeyframeInfo!.layerId,
          'tracks',
          (t: any) => t.property === dragKeyframeInfo!.property,
          'keyframes',
          dragKeyframeInfo.index,
          'at',
          newAt
        );
        return;
      }

      // Cursor hover feedback
      if (y <= RULER_H) {
        canvasRef.style.cursor = 'pointer';
        return;
      }

      const unshiftedY = y + state.timelineScrollY;
      const { layout } = computeTrackLayout();
      let hoveredCursor = 'crosshair';

      for (const item of layout) {
        if (unshiftedY >= item.y && unshiftedY <= item.y + item.h) {
          const x1 = timeToX(item.layer.at || 0);
          const layerDur = item.layer.duration || totalDuration() - (item.layer.at || 0);
          const x2 = timeToX((item.layer.at || 0) + layerDur);

          if (Math.abs(x - x1) <= edgeHoverZone || Math.abs(x - x2) <= edgeHoverZone) {
            hoveredCursor = 'ew-resize';
            break;
          } else if (x >= x1 && x <= x2) {
            hoveredCursor = 'move';
            break;
          }
        }
      }

      canvasRef.style.cursor = hoveredCursor;
    };

    const onMouseUp = () => {
      if (hasDragged && dragMode) {
        store.setState('dirty', true);
        store.syncDesktopDirty();
        store.executeSave();
      }
      hasDragged = false;
      isDraggingPlayhead = false;
      isPanning = false;
      dragMode = null;
      dragLayer = null;
      dragKeyframeInfo = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (!canvasRef) return;
        const rect = canvasRef.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const timeAtMouse = xToTime(mouseX);
        const factor = e.deltaY < 0 ? 1.15 : 0.85;
        const nextZoom = Math.max(0.5, Math.min(8, state.zoom * factor));
        store.setZoom(nextZoom);
        const newXAtTime = timeToX(timeAtMouse);
        store.setPanOffset(state.panOffset + (mouseX - newXAtTime));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        store.setPanOffset(state.panOffset - (e.deltaX || e.deltaY));
      } else {
        // Vertical scrolling
        e.preventDefault();
        const { totalHeight } = computeTrackLayout();
        const visibleH = (canvasRef?.clientHeight || 200) - RULER_H;
        const maxScroll = Math.max(0, totalHeight - visibleH);
        const nextScroll = Math.max(0, Math.min(maxScroll, state.timelineScrollY + e.deltaY));
        store.setTimelineScrollY(nextScroll);
      }
    };

    if (canvasRef) {
      canvasRef.addEventListener('mousedown', onMouseDown);
      canvasRef.addEventListener('wheel', onWheel, { passive: false });
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    onCleanup(() => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKeyDown);
      canvasRef?.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvasRef?.removeEventListener('wheel', onWheel);
    });
  });

  const [isTimelineDragOver, setIsTimelineDragOver] = createSignal(false);
  const [dragOverTime, setDragOverTime] = createSignal<number | null>(null);

  const handleTimelineDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    if (canvasRef) {
      const rect = canvasRef.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setDragOverTime(Math.max(0, Math.min(totalDuration(), Math.round(xToTime(x)))));
    }
  };

  const handleTimelineDragEnter = (e: DragEvent) => {
    e.preventDefault();
    setIsTimelineDragOver(true);
  };

  const handleTimelineDragLeave = (e: DragEvent) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsTimelineDragOver(false);
      setDragOverTime(null);
    }
  };

  const handleTimelineDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsTimelineDragOver(false);
    setDragOverTime(null);

    if (!state.scene) {
      store.addToast('Load or create a scene before dropping assets', 'warning');
      return;
    }

    if (!canvasRef) return;
    const rect = canvasRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const dropTime = Math.max(0, Math.min(totalDuration(), Math.round(xToTime(x))));

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

    if (!assetData) {
      store.addToast('Unrecognized asset dropped onto timeline', 'warning');
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
          at: dropTime,
          sfx: sfxName as any,
          gain: 1,
          pan: 0,
        });
        store.addToast(`Added audio cue "${sfxName}" at ${dropTime}ms`, 'success');
      } else if (kind === 'lottie') {
        sc.layers.push({
          id: newLayerId,
          name: assetData?.name || `Lottie ${assetId}`,
          type: 'lottie',
          assetId,
          position: { xPct: 50, yPct: 50 },
          at: dropTime,
          duration: 3000,
        });
        store.selectLayer(newLayerId);
        store.addToast(`Added Lottie layer at ${dropTime}ms`, 'success');
      } else {
        sc.layers.push({
          id: newLayerId,
          name: assetData?.name || `Image ${assetId}`,
          type: 'imageLogo',
          assetId,
          widthPx: 300,
          position: { xPct: 50, yPct: 50 },
          at: dropTime,
          duration: 3000,
        });
        store.selectLayer(newLayerId);
        store.addToast(`Added Image layer at ${dropTime}ms`, 'success');
      }
    }, `Dropped asset ${assetId} onto timeline`);

    store.setPlayhead(dropTime);
    store.executeSave();
  };

  const timelineInfo = () => {
    const dur = totalDuration();
    const visibleDur = (dur / state.zoom / 1000).toFixed(1);
    return `${Math.round(state.zoom * 100)}% · ${visibleDur}s visible`;
  };

  return (
    <section class="timeline-area flex flex-col h-full bg-[#0a0a0f]" aria-label="Interactive timeline">
      {/* TIMELINE TOOLBAR */}
      <div class="timeline-toolbar flex items-center justify-between px-3 py-1.5 bg-[#101017] border-b border-[#1f1f2e] text-xs">
        <div class="flex items-center gap-1.5">
          <button
            class="tool-btn px-2 py-1 bg-[#181824] hover:bg-[#252538] text-[#e4e4e7] rounded font-medium"
            id="btn-fit"
            data-tooltip="Fit timeline duration to window"
            onClick={() => {
              store.setZoom(1);
              store.setPanOffset(0);
            }}
          >
            Fit
          </button>
          <button
            class={`tool-btn px-2 py-1 rounded font-medium ${state.snapEnabled ? 'bg-[#f59e0b]/20 text-[#f59e0b]' : 'bg-[#181824] text-[#71717a]'}`}
            id="btn-snap"
            data-tooltip="Magnetic 100ms and keyframe snap"
            onClick={() => store.setSnapEnabled(!state.snapEnabled)}
          >
            {state.snapEnabled ? 'Snap: ON' : 'Snap: OFF'}
          </button>
          <div class="w-px h-4 bg-[#252538] mx-1" />
          <button
            class="tool-btn px-2 py-1 bg-[#181824] hover:bg-[#252538] text-[#e4e4e7] rounded"
            title="Razor Split at Playhead (Ctrl+K)"
            onClick={() => store.razorSplitAtPlayhead()}
          >
            ✂ Split (Ctrl+K)
          </button>
          <button
            class="tool-btn px-2 py-1 bg-[#181824] hover:bg-[#252538] text-[#e4e4e7] rounded"
            title="Ripple Delete Selected Layer (Shift+Del)"
            onClick={() => store.rippleDeleteSelected()}
          >
            Ripple Del
          </button>
          <div class="w-px h-4 bg-[#252538] mx-1" />
          <button
            class="tool-btn px-1.5 py-1 bg-[#181824] hover:bg-[#252538] text-[#22d3ee] rounded font-mono text-[11px]"
            title="Set In-point (I)"
            onClick={() => store.setInPoint(state.playhead)}
          >
            [ I ]
          </button>
          <button
            class="tool-btn px-1.5 py-1 bg-[#181824] hover:bg-[#252538] text-[#22d3ee] rounded font-mono text-[11px]"
            title="Set Out-point (O)"
            onClick={() => store.setOutPoint(state.playhead)}
          >
            [ O ]
          </button>
          <Show when={state.inPoint !== null || state.outPoint !== null}>
            <button
              class="tool-btn px-1.5 py-1 text-[#71717a] hover:text-white text-[11px]"
              title="Clear In/Out Points"
              onClick={() => {
                store.setInPoint(null);
                store.setOutPoint(null);
              }}
            >
              Clear
            </button>
          </Show>
        </div>

        <div class="text-[11px] text-[#71717a] hidden md:block">
          JKL: Play/Reverse · I/O: In/Out · Ctrl+K: Split · Shift+Del: Ripple Del
        </div>

        <div class="flex items-center gap-2">
          <span class="timeline-info font-mono text-[11px] text-[#a1a1aa]" id="timeline-info">
            {timelineInfo()}
          </span>
        </div>
      </div>

      {/* MULTI-TRACK NLE WORKSPACE */}
      <div class="flex-1 flex overflow-hidden relative">
        {/* LEFT TRACK HEADERS PANEL (220px) */}
        <div
          ref={tracksScrollRef}
          id="timeline-tracks-scroll"
          class="w-[220px] flex-none bg-[#0e0e15] border-r border-[#1f1f2e] overflow-y-auto overflow-x-hidden select-none"
          style={{ 'padding-top': `${RULER_H}px` }}
          onScroll={onTracksScroll}
        >
          <For each={computedTracks()}>
            {(track) => {
              const primaryLayer = () => track.layers[0];
              const isSelected = () =>
                track.layers.some(
                  (l) => state.selectedLayerIds.includes(l.id) || state.selectedLayerId === l.id
                );
              const anyExpandedLayer = () =>
                track.layers.find((l) => state.expandedLayerIds.includes(l.id));
              const isExpanded = () => Boolean(anyExpandedLayer());
              const expandedLayer = () => anyExpandedLayer() || primaryLayer();
              const props = () =>
                isExpanded() && expandedLayer() ? getLayerAnimatableProps(expandedLayer()!) : [];

              const trackTypeColor = () => {
                if (track.kind === 'audio') return '#10b981';
                if (track.layers.length > 0) return getLayerColor(track.layers[0].type);
                return '#6366f1';
              };

              return (
                <div
                  class="border-b border-[#181824]/60"
                  data-track-index={track.index}
                  data-layer-id={track.layers[0]?.id}
                  style={{ 'margin-bottom': `${TRACK_GAP}px` }}
                >
                  {/* MAIN TRACK HEADER */}
                  <div
                    class={`flex items-center gap-1.5 px-2 h-[28px] cursor-pointer hover:bg-[#181824] ${
                      isSelected() ? 'bg-[#1e1e2d]' : ''
                    }`}
                    onClick={() => {
                      if (track.layers.length > 0) {
                        store.selectLayer(track.layers[0].id);
                      }
                    }}
                  >
                    <Show
                      when={track.layers.length > 0}
                      fallback={<span class="w-4" />}
                    >
                      <button
                        class="text-[10px] text-[#71717a] hover:text-white w-4 text-center"
                        title={isExpanded() ? 'Collapse tracks' : 'Expand tracks'}
                        onClick={(e) => {
                          e.stopPropagation();
                          const target = expandedLayer();
                          if (target) {
                            store.toggleLayerExpanded(target.id);
                          }
                        }}
                      >
                        {isExpanded() ? '▼' : '▶'}
                      </button>
                    </Show>

                    <span class="px-1 py-0.2 text-[9px] font-mono rounded bg-[#1e1e2d] text-[#818cf8] border border-[#27273a] flex-none">
                      T{track.index + 1}
                    </span>

                    <span
                      class="w-2 h-2 rounded-full flex-none"
                      style={{ background: trackTypeColor() }}
                    />

                    <span class="truncate flex-1 font-medium text-xs text-[#e4e4e7]" title={track.name}>
                      {track.layers.length > 1
                        ? `${track.name} (${track.layers.length} clips)`
                        : track.layers[0]?.name || track.layers[0]?.id || track.name}
                    </span>
                  </div>

                  {/* EXPANDED PROPERTY TRACKS */}
                  <Show when={isExpanded() && expandedLayer()}>
                    <div class="bg-[#08080c]">
                      <For each={props()}>
                        {(prop) => {
                          const layer = expandedLayer()!;
                          const trk = (layer.tracks as any[])?.find((t) => t.property === prop);
                          const hasTrack = Boolean(trk && trk.keyframes?.length > 0);

                          return (
                            <div class="flex items-center justify-between pl-6 pr-2 h-[22px] text-[11px] text-[#a1a1aa] hover:bg-[#14141d]">
                              <span class="truncate">{prop}</span>
                              <div class="flex items-center gap-1.5">
                                <button
                                  class={`text-[10px] hover:text-white ${hasTrack ? 'text-[#f59e0b]' : 'text-[#52525b]'}`}
                                  title={hasTrack ? 'Keyframing enabled' : 'Enable keyframing'}
                                  onClick={() => {
                                    const val = (layer as any)[prop] ?? 0;
                                    store.addKeyframe(layer.id, prop, state.playhead, val);
                                  }}
                                >
                                  ⏱
                                </button>
                                <button
                                  class="text-[10px] text-[#71717a] hover:text-[#f59e0b]"
                                  title="Add keyframe at playhead"
                                  onClick={() => {
                                    const val = (layer as any)[prop] ?? 0;
                                    store.addKeyframe(layer.id, prop, state.playhead, val);
                                  }}
                                >
                                  ◆
                                </button>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>

        {/* RIGHT CANVAS TIMELINE AREA */}
        <div
          id="timeline-canvas-container"
          class={`flex-1 h-full overflow-hidden relative ${
            isTimelineDragOver() ? 'ring-2 ring-inset ring-[#22d3ee] bg-[#22d3ee]/5' : ''
          }`}
          onDragOver={handleTimelineDragOver}
          onDragEnter={handleTimelineDragEnter}
          onDragLeave={handleTimelineDragLeave}
          onDrop={handleTimelineDrop}
        >
          {/* DRAG-OVER DROP TIME GUIDE */}
          <Show when={isTimelineDragOver() && dragOverTime() !== null}>
            <div
              class="absolute top-0 bottom-0 w-0.5 bg-[#22d3ee] pointer-events-none z-30 shadow-[0_0_8px_#22d3ee]"
              style={{ left: `${timeToX(dragOverTime()!)}px` }}
            >
              <div class="absolute top-1 left-1.5 px-1.5 py-0.5 rounded bg-[#0e1726] border border-[#22d3ee] text-[10px] font-mono text-[#22d3ee] whitespace-nowrap shadow-md">
                + Drop at {(dragOverTime()! / 1000).toFixed(2)}s
              </div>
            </div>
          </Show>

          <canvas
            ref={canvasRef}
            id="timeline-canvas"
            class="w-full h-full block"
            role="slider"
            aria-label="Timeline scrubber"
            aria-valuemin={0}
            aria-valuemax={totalDuration()}
            aria-valuenow={state.playhead}
          />
          {/* Vertical scrollbar for canvas tracks */}
          <div
            ref={verticalScrollbarRef}
            id="timeline-vertical-scrollbar"
            class="absolute top-[28px] right-0 bottom-0 w-2.5 overflow-y-auto overflow-x-hidden z-10 select-none"
            onScroll={onVerticalScrollbarScroll}
          >
            <div style={{ height: `${Math.max(1, computeTrackLayout().totalHeight - RULER_H)}px`, width: '1px' }} />
          </div>
        </div>
      </div>
    </section>
  );
};
