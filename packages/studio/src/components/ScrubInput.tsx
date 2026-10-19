import { Component, createSignal, onCleanup } from 'solid-js';

export interface ScrubInputProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
  onScrubStart?: () => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  id?: string;
}

export const ScrubInput: Component<ScrubInputProps> = (props) => {
  const [isEditing, setIsEditing] = createSignal(false);
  const [isScrubbing, setIsScrubbing] = createSignal(false);
  const [localText, setLocalText] = createSignal(String(props.value));

  let startX = 0;
  let startVal = 0;
  let currentVal = 0;
  let hasMoved = false;
  let inputEl: HTMLInputElement | undefined;

  const step = () => props.step ?? 1;

  const clamp = (val: number) => {
    let res = val;
    if (typeof props.min === 'number') res = Math.max(props.min, res);
    if (typeof props.max === 'number') res = Math.min(props.max, res);
    return res;
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (props.disabled) return;
    if (isEditing()) return;

    startX = e.clientX;
    startVal = Number(props.value) || 0;
    currentVal = startVal;
    hasMoved = false;
    setIsScrubbing(true);

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) >= 1 && !hasMoved) {
        hasMoved = true;
        props.onScrubStart?.();
      }

      let multiplier = 1;
      if (ev.shiftKey) multiplier = 10;
      if (ev.altKey) multiplier = 0.1;

      const deltaVal = dx * step() * multiplier;
      let nextVal = startVal + deltaVal;

      if (step() >= 1 && !ev.altKey) {
        nextVal = Math.round(nextVal);
      } else {
        nextVal = Math.round(nextVal * 10) / 10;
      }

      nextVal = clamp(nextVal);
      currentVal = nextVal;
      setLocalText(String(nextVal));
      props.onChange(nextVal);
    };

    const onPointerUp = (ev: PointerEvent) => {
      setIsScrubbing(false);
      target.releasePointerCapture?.(ev.pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      if (hasMoved) {
        props.onCommit?.(currentVal);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const commitEdit = () => {
    setIsEditing(false);
    const parsed = parseFloat(localText());
    if (!isNaN(parsed)) {
      const clamped = clamp(parsed);
      setLocalText(String(clamped));
      props.onScrubStart?.();
      props.onChange(clamped);
      props.onCommit?.(clamped);
    } else {
      setLocalText(String(props.value));
    }
  };

  return (
    <div
      class={`scrub-input-wrap flex items-center bg-[var(--bg-2)] border border-[var(--border)] rounded px-2 py-1 text-xs select-none transition-colors ${
        isScrubbing()
          ? 'border-[var(--primary)] ring-1 ring-[var(--primary)] bg-[var(--bg-3)]'
          : 'hover:border-[var(--border-strong)]'
      } ${props.disabled ? 'opacity-50 pointer-events-none' : ''}`}
      id={props.id}
    >
      <span
        class="scrub-label font-mono font-bold text-[10px] text-[var(--primary)] tracking-wide cursor-ew-resize mr-1.5 select-none hover:text-[var(--primary-hover)] flex items-center gap-0.5"
        title="Drag left/right to scrub numeric value (Shift = 10x, Alt = 0.1x)"
        onPointerDown={handlePointerDown}
      >
        <span>{props.label}</span>
      </span>

      {isEditing() ? (
        <input
          ref={inputEl}
          type="text"
          class="scrub-native-input flex-1 bg-transparent text-[var(--text-1)] font-mono text-xs outline-none w-full"
          value={localText()}
          onInput={(e) => setLocalText(e.currentTarget.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') {
              setLocalText(String(props.value));
              setIsEditing(false);
            }
          }}
          autoFocus
        />
      ) : (
        <div
          class="scrub-value-display flex-1 flex items-center justify-between font-mono text-xs text-[var(--text-1)] cursor-text"
          onClick={() => {
            if (props.disabled) return;
            setLocalText(String(props.value));
            setIsEditing(true);
            setTimeout(() => inputEl?.select(), 0);
          }}
          onPointerDown={handlePointerDown}
        >
          <span class="truncate">{props.value}</span>
          {props.unit && (
            <span class="text-[10px] text-[var(--text-3)] font-sans ml-1 flex-none">{props.unit}</span>
          )}
        </div>
      )}
    </div>
  );
};
