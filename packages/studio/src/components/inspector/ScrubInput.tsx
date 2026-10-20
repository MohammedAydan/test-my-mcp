import { Component, Show, createSignal, onCleanup } from 'solid-js';
import { capturePointer, releasePointer } from '../../services/pointer-capture.js';

/**
 * The Pro NLE numeric field.
 *
 * Drag the label horizontally to scrub the value; click the value to type an
 * exact one. `Shift` = 10x, `Alt` = 0.1x.
 *
 * The contract is what makes it composable:
 *  - `onScrubStart()` fires ONCE, at the first pixel of movement,
 *  - `onChange(v)` fires continuously,
 *  - `onCommit(v)` fires ONCE, on release.
 *
 * The Inspector pushes ONE undo snapshot in `onScrubStart` and issues ONE
 * atomic save in `onCommit` — so a drag is a single undo step and a single
 * write to disk.
 */

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

  const clamp = (val: number): number => {
    let result = val;
    if (typeof props.min === 'number') result = Math.max(props.min, result);
    if (typeof props.max === 'number') result = Math.min(props.max, result);
    return result;
  };

  /**
   * Where the value sits inside its `min..max` range, as a percentage.
   *
   * `null` when the field has no range — the fill bar is then meaningless.
   */
  const fillPercent = (): number | null => {
    const min = props.min;
    const max = props.max;
    if (typeof min !== 'number' || typeof max !== 'number' || max === min) return null;
    const value = Number(props.value);
    if (!Number.isFinite(value)) return null;
    const ratio = (value - min) / (max - min);
    return Math.max(0, Math.min(100, ratio * 100));
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (props.disabled || isEditing()) return;
    event.preventDefault();

    startX = event.clientX;
    startVal = Number(props.value) || 0;
    currentVal = startVal;
    hasMoved = false;
    setIsScrubbing(true);

    const target = event.currentTarget as HTMLElement;
    capturePointer(target, event.pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      if (Math.abs(dx) >= 1 && !hasMoved) {
        hasMoved = true;
        props.onScrubStart?.();
      }

      let multiplier = 1;
      if (moveEvent.shiftKey) multiplier = 10;
      if (moveEvent.altKey) multiplier = 0.1;

      let next = startVal + dx * step() * multiplier;
      next = step() >= 1 && !moveEvent.altKey ? Math.round(next) : Math.round(next * 10) / 10;
      next = clamp(next);
      currentVal = next;
      setLocalText(String(next));
      props.onChange(next);
    };

    const onPointerUp = () => {
      setIsScrubbing(false);
      releasePointer(target, event.pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (hasMoved) props.onCommit?.(currentVal);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    onCleanup(() => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    });
  };

  const commitEdit = () => {
    setIsEditing(false);
    const parsed = Number.parseFloat(localText());
    if (!Number.isNaN(parsed)) {
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
      class={`mf-scrub ${isScrubbing() ? 'is-scrubbing' : ''} ${props.disabled ? 'is-disabled' : ''}`}
      id={props.id}
    >
      <Show when={fillPercent() !== null}>
        <span
          class="mf-scrub-fill"
          style={`--scrub-fill:${(fillPercent() ?? 0).toFixed(2)}%`}
          aria-hidden="true"
        />
      </Show>

      <span
        class="mf-scrub-label"
        title="Drag to scrub (Shift = 10x, Alt = 0.1x)"
        onPointerDown={handlePointerDown}
      >
        {props.label}
      </span>

      <Show
        when={isEditing()}
        fallback={
          <div
            class="mf-scrub-value"
            onClick={() => {
              if (props.disabled) return;
              setLocalText(String(props.value));
              setIsEditing(true);
              setTimeout(() => inputEl?.select(), 0);
            }}
            onPointerDown={handlePointerDown}
          >
            <span>{props.value}</span>
            <Show when={props.unit}>
              <span class="mf-scrub-unit">{props.unit}</span>
            </Show>
          </div>
        }
      >
        <input
          ref={(el) => {
            inputEl = el;
          }}
          class="mf-scrub-input"
          type="text"
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
          autofocus
        />
      </Show>
    </div>
  );
};
