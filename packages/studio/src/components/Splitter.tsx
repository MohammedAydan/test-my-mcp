import { Component, createSignal } from 'solid-js';

export interface SplitterVerticalProps {
  id?: string;
  onResize: (clientX: number) => void;
  onDoubleClick?: () => void;
  title?: string;
}

export const SplitterVertical: Component<SplitterVerticalProps> = (props) => {
  const [isDragging, setIsDragging] = createSignal(false);

  const handlePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging()) return;
    props.onResize(e.clientX);
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (!isDragging()) return;
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      id={props.id}
      class={`splitter-vertical ${isDragging() ? 'is-active' : ''}`}
      title={props.title || 'Drag to resize, double-click to toggle collapse'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDblClick={() => props.onDoubleClick?.()}
    />
  );
};

export interface SplitterHorizontalProps {
  id?: string;
  onResize: (clientY: number) => void;
  onDoubleClick?: () => void;
  title?: string;
}

export const SplitterHorizontal: Component<SplitterHorizontalProps> = (props) => {
  const [isDragging, setIsDragging] = createSignal(false);

  const handlePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging()) return;
    props.onResize(e.clientY);
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (!isDragging()) return;
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      id={props.id}
      class={`splitter-horizontal ${isDragging() ? 'is-active' : ''}`}
      title={props.title || 'Drag to resize, double-click to toggle collapse'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDblClick={() => props.onDoubleClick?.()}
    />
  );
};
