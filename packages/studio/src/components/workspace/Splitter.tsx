import { Component, createSignal, onMount } from 'solid-js';
import { capturePointer, releasePointer } from '../../services/pointer-capture.js';

/**
 * The 4px resize splitter.
 *
 * A pointer-capture drag that reports the CLIENT coordinate, so the caller
 * can map it into its own geometry (the panel widths are derived from the
 * workspace bounds, not from a delta).
 *
 * Double-clicking resets to the default size, and the result is persisted to
 * `localStorage` when a `storageKey` is given.
 */

export interface SplitterProps {
  id?: string;
  orientation: 'vertical' | 'horizontal';
  /** the current size (px) — used for the double-click reset */
  size: number;
  /** the default size the double-click resets to */
  defaultSize: number;
  /** called with the CLIENT coordinate while dragging */
  onResize: (client: number) => void;
  /** called on a double click (usually: toggle collapse) */
  onDoubleClick?: () => void;
  /** `localStorage` key for the persisted size */
  storageKey?: string;
  title?: string;
}

export const Splitter: Component<SplitterProps> = (props) => {
  const [isDragging, setIsDragging] = createSignal(false);
  let elementRef: HTMLDivElement | undefined;

  const readStored = (): number | null => {
    if (!props.storageKey) return null;
    try {
      const raw = localStorage.getItem(props.storageKey);
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };

  const writeStored = (value: number) => {
    if (!props.storageKey) return;
    try {
      localStorage.setItem(props.storageKey, String(Math.round(value)));
    } catch {
      /* storage is a convenience, not a contract */
    }
  };

  onMount(() => {
    const stored = readStored();
    if (stored !== null && stored !== props.size) {
      props.onResize(stored);
    }
  });

  const handlePointerDown = (event: PointerEvent) => {
    event.preventDefault();
    setIsDragging(true);
    capturePointer(elementRef, event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!isDragging()) return;
    props.onResize(props.orientation === 'vertical' ? event.clientX : event.clientY);
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (!isDragging()) return;
    setIsDragging(false);
    releasePointer(elementRef, event.pointerId);
    writeStored(props.size);
  };

  const handleDoubleClick = () => {
    writeStored(props.defaultSize);
    props.onDoubleClick?.();
  };

  return (
    <div
      ref={elementRef}
      id={props.id}
      class={`mf-splitter is-${props.orientation} ${isDragging() ? 'is-active' : ''}`}
      role="separator"
      aria-orientation={props.orientation === 'vertical' ? 'vertical' : 'horizontal'}
      aria-label={props.title ?? 'Resize'}
      title={props.title ?? 'Drag to resize, double-click to reset'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDblClick={handleDoubleClick}
    />
  );
};
