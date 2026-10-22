import { Component, Show, createEffect, onMount } from 'solid-js';
import type { StudioLayer } from '../../types.js';
import { layerVariant } from '../../types.js';
import { IconPencil } from '../icons/NleIcons.js';

/**
 * The INLINE canvas text editor.
 *
 * A double-click on a text layer opens a real editor exactly over the layer,
 * styled like the layer itself — the same font, size, weight, colour and
 * alignment — so the edit reads as an in-place change rather than a modal
 * detour.
 *
 * The editor is NOT part of the `ephemeralTransform` flow: it writes the
 * text through the store, which is the only writer of the scene.
 */

export type EditableField = 'text' | 'title' | 'body';

export interface InlineEditorRect {
  /** overlay-local px */
  left: number;
  top: number;
  width: number;
  height: number;
  /** degrees */
  rotation: number;
}

export interface InlineTextEditorProps {
  layer: StudioLayer;
  field: EditableField;
  rect: InlineEditorRect;
  /** screen px per composition px */
  scale: number;
  onCommit: (field: EditableField, value: string) => void;
  onCancel: () => void;
  onFieldChange?: (field: EditableField) => void;
}

/** The current text of one editable field. */
export function fieldValue(layer: StudioLayer, field: EditableField): string {
  if (field === 'text') return typeof layer.text === 'string' ? layer.text : '';
  const variant = layerVariant(layer);
  const raw = field === 'title' ? variant.title : variant.body;
  return typeof raw === 'string' ? raw : '';
}

/** The design-space font size of one editable field. */
export function fieldFontSize(layer: StudioLayer, field: EditableField): number {
  if (layer.type === 'kineticText') return layer.sizePx ?? 64;
  return field === 'title' ? 34 : 22;
}

/** The colour the field is painted with. */
export function fieldColor(layer: StudioLayer): string {
  const fill = layer.fill;
  if (typeof fill === 'string') return fill;
  if (fill && typeof fill === 'object') {
    const color = (fill as { color?: unknown }).color;
    if (typeof color === 'string') return color;
  }
  return '#ffffff';
}

export const InlineTextEditor: Component<InlineTextEditorProps> = (props) => {
  let inputRef: HTMLDivElement | undefined;
  let settled = false;

  const isCard = () => props.layer.type === 'card';
  /** the card's variant carries a `title` */
  const hasTitle = () => isCard() && typeof layerVariant(props.layer).title === 'string';
  /** the card's variant carries a `body` */
  const hasBody = () => isCard() && typeof layerVariant(props.layer).body === 'string';

  const fontSize = () => Math.max(8, fieldFontSize(props.layer, props.field) * props.scale);
  const fontWeight = () => {
    if (!isCard()) return props.layer.fontWeight ?? 700;
    return props.field === 'title' ? 800 : 400;
  };
  const textAlign = (): 'left' | 'right' | 'center' => {
    if (!isCard()) {
      const align = props.layer.align;
      if (align === 'left' || align === 'right' || align === 'center') return align;
      return 'center';
    }
    const rtl = props.layer.direction === 'rtl';
    return rtl ? 'right' : 'left';
  };
  const fontFamily = () =>
    props.layer.googleFamily ? `'${props.layer.googleFamily}', var(--mf-font-ui)` : 'var(--mf-font-ui)';

  const commit = () => {
    if (settled) return;
    settled = true;
    const raw = inputRef?.innerText ?? '';
    props.onCommit(props.field, raw.replace(/\u00a0/g, ' ').replace(/\n+$/, ''));
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    props.onCancel();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      commit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  /** the editor owns its pointer events — the overlay must not start a drag */
  const swallow = (event: Event) => {
    event.stopPropagation();
  };

  createEffect(() => {
    // re-seed the editable content when the edited field changes
    const el = inputRef;
    if (!el) return;
    const next = fieldValue(props.layer, props.field);
    if (el.innerText !== next) el.innerText = next;
  });

  onMount(() => {
    const el = inputRef;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  });

  return (
    <div
      class="mf-inline-editor"
      id="canvas-inline-editor"
      data-layer-id={props.layer.id}
      data-field={props.field}
      style={{
        position: 'absolute',
        left: `${props.rect.left}px`,
        top: `${props.rect.top}px`,
        width: `${Math.max(24, props.rect.width)}px`,
        height: `${Math.max(20, props.rect.height)}px`,
        transform: `rotate(${props.rect.rotation}deg)`,
        'transform-origin': 'center center',
        'z-index': '30',
      }}
      onPointerDown={swallow}
      onMouseDown={swallow}
    >
      <div
        class="mf-inline-editor-bar"
        id="canvas-inline-editor-bar"
        style={{
          position: 'absolute',
          right: '0',
          bottom: '100%',
          display: 'flex',
          'align-items': 'center',
          gap: '4px',
          margin: '0 0 4px 0',
          padding: '3px 6px',
          background: 'var(--mf-bg-elevated)',
          border: '1px solid var(--mf-border-focus)',
          'border-radius': 'var(--mf-radius-xs, var(--radius-xs, 4px))',
          'box-shadow': 'var(--shadow-sm)',
          color: 'var(--mf-accent-text)',
          'font-family': 'var(--mf-font-ui)',
          'font-size': '10px',
          'white-space': 'nowrap',
        }}
        onPointerDown={swallow}
      >
        <IconPencil size={12} />
        <Show when={isCard() && hasTitle()}>
          <button
            type="button"
            class="mf-inline-editor-field"
            id="canvas-inline-editor-field-title"
            onMouseDown={(e) => e.preventDefault()}
            style={{
              background: props.field === 'title' ? 'var(--mf-accent-dim)' : 'transparent',
              color: props.field === 'title' ? 'var(--mf-accent-text)' : 'var(--mf-text-2)',
              'border-radius': 'var(--mf-radius-xs, var(--radius-xs, 4px))',
              padding: '1px 5px',
              'font-size': '10px',
            }}
            onClick={() => props.onFieldChange?.('title')}
          >
            Title
          </button>
        </Show>
        <Show when={isCard() && hasBody()}>
          <button
            type="button"
            class="mf-inline-editor-field"
            id="canvas-inline-editor-field-body"
            onMouseDown={(e) => e.preventDefault()}
            style={{
              background: props.field === 'body' ? 'var(--mf-accent-dim)' : 'transparent',
              color: props.field === 'body' ? 'var(--mf-accent-text)' : 'var(--mf-text-2)',
              'border-radius': 'var(--mf-radius-xs, var(--radius-xs, 4px))',
              padding: '1px 5px',
              'font-size': '10px',
            }}
            onClick={() => props.onFieldChange?.('body')}
          >
            Body
          </button>
        </Show>
        <span style={{ color: 'var(--mf-text-3)' }}>Enter commits · Esc cancels</span>
      </div>

      <div
        ref={inputRef}
        class="mf-inline-editor-input"
        id="canvas-inline-editor-input"
        contentEditable={true}
        spellcheck={false}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          'font-family': fontFamily(),
          'font-size': `${fontSize()}px`,
          'font-weight': `${fontWeight()}`,
          'line-height': `${props.layer.lineHeight ?? 1.2}`,
          'letter-spacing': `${props.layer.letterSpacingPx ?? 0}px`,
          color: fieldColor(props.layer),
          'text-align': textAlign(),
          direction: props.layer.direction === 'rtl' ? 'rtl' : 'ltr',
          'white-space': 'pre-wrap',
          'word-break': 'break-word',
          background: 'rgba(9, 10, 13, 0.72)',
          outline: '1px solid var(--mf-border-focus)',
          'border-radius': 'var(--mf-radius-xs, var(--radius-xs, 4px))',
          padding: isCard() ? '10px 12px' : '2px 4px',
          cursor: 'text',
        }}
        onKeyDown={onKeyDown}
        onBlur={commit}
        onPointerDown={swallow}
      />
    </div>
  );
};
