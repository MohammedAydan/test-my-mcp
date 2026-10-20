import { describe, expect, it } from 'vitest';
import { sanitizeSceneInput } from '@motionforge/scene-spec';
import { buildAssetPayload, readAssetPayload, writeAssetPayload } from '../src/services/drag-payload.js';

/**
 * The Project Bin's drag payload.
 *
 * The monitor and the timeline both read this envelope, so its shape is a
 * contract: a payload that cannot be parsed must degrade to a clear warning,
 * never to a silent no-op.
 */
describe('asset drag payload', () => {
  it('round-trips through the JSON envelope', () => {
    const payload = buildAssetPayload({
      id: 'logo',
      kind: 'image',
      src: 'vault:logo.png',
      name: 'Logo',
    });
    expect(payload).toEqual({
      assetId: 'logo',
      kind: 'image',
      src: 'vault:logo.png',
      name: 'Logo',
    });
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('defaults the name to the id', () => {
    expect(buildAssetPayload({ id: 'pop', kind: 'audio' }).name).toBe('pop');
  });

  it('parses a JSON payload out of a drag event', () => {
    const raw = JSON.stringify({ assetId: 'logo', kind: 'image' });
    const event = {
      dataTransfer: {
        getData: (type: string) => (type === 'application/json' ? raw : ''),
      },
    } as unknown as DragEvent;
    expect(readAssetPayload(event)).toEqual({ assetId: 'logo', kind: 'image' });
  });

  it('falls back to the plain-text form', () => {
    const event = {
      dataTransfer: {
        getData: (type: string) => (type === 'text/plain' ? 'pop' : ''),
      },
    } as unknown as DragEvent;
    expect(readAssetPayload(event)).toEqual({ assetId: 'pop', kind: 'image' });
  });

  it('returns null for an empty drop', () => {
    const event = {
      dataTransfer: { getData: () => '' },
    } as unknown as DragEvent;
    expect(readAssetPayload(event)).toBeNull();
  });

  it('writes both the JSON and the plain-text form', () => {
    const written: Record<string, string> = {};
    const event = {
      dataTransfer: {
        setData: (type: string, value: string) => {
          written[type] = value;
        },
        effectAllowed: '',
      },
    } as unknown as DragEvent;
    writeAssetPayload(event, { id: 'logo', kind: 'image', src: 'vault:logo.png' });
    expect(written['application/json']).toContain('"assetId":"logo"');
    expect(written['text/plain']).toBe('logo');
  });
});

describe('the shared sanitizer boundary', () => {
  it('is the SAME normalizer the engine applies', () => {
    // the Studio and the engine must agree — a payload the renderer sends
    // must survive the engine's own normalization unchanged
    const payload = {
      schemaVersion: 1,
      name: 'Sanitizer Boundary',
      canvas: { shape: '16:9', scale: 1080 },
      durationMs: 2000,
      layers: [
        {
          id: 'bg',
          type: 'background',
          variant: { variant: 'solid', color: '#000000' },
          position: { xPct: 50, yPct: 50 },
          _hidden: false,
        },
      ],
    };
    const once = sanitizeSceneInput(payload);
    const twice = sanitizeSceneInput(once);
    expect(twice).toEqual(once);
    expect((once as any).layers[0]._hidden).toBeUndefined();
    expect((once as any).layers[0].visible).toBe(true);
  });
});
