import { z } from "zod";

/**
 * Standard layout slots for automated layer positioning and sizing.
 */
export const LAYOUT_SLOTS = [
  "heroCenter",
  "topHeader",
  "topSubhead",
  "bottomSubhead",
  "bottomCenterCta",
  "splitLeft",
  "splitRight",
  "gridTopLeft",
  "gridTopRight",
  "gridBottomLeft",
  "gridBottomRight",
  "centerStage",
] as const;

export type LayoutSlot = (typeof LAYOUT_SLOTS)[number];

export const layoutSlotSchema = z.enum(LAYOUT_SLOTS);

export interface LayoutSlotBox {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

/**
 * Exact slot boxes in percent of canvas coordinates.
 *
 * NOTE: The slot coordinates are fixed by design.
 * `centerStage` (y 56, h 58 -> 27..85) intentionally overlaps `topSubhead` (24..34)
 * and `bottomCenterCta` (78..90); it is a central CONTAINER slot, not a peer tile.
 * Guaranteed-disjoint triples (e.g. `topHeader` + `topSubhead` + `bottomCenterCta`)
 * provide zero-overlap peer placement.
 */
export const LAYOUT_SLOT_BOXES: Record<LayoutSlot, LayoutSlotBox> = {
  topHeader: { xPct: 50, yPct: 16, widthPct: 82, heightPct: 14 },
  topSubhead: { xPct: 50, yPct: 29, widthPct: 74, heightPct: 10 },
  heroCenter: { xPct: 50, yPct: 44, widthPct: 80, heightPct: 24 },
  bottomSubhead: { xPct: 50, yPct: 66, widthPct: 72, heightPct: 12 },
  bottomCenterCta: { xPct: 50, yPct: 84, widthPct: 36, heightPct: 12 },
  splitLeft: { xPct: 28, yPct: 54, widthPct: 40, heightPct: 56 },
  splitRight: { xPct: 72, yPct: 54, widthPct: 40, heightPct: 56 },
  gridTopLeft: { xPct: 29, yPct: 38, widthPct: 38, heightPct: 28 },
  gridTopRight: { xPct: 71, yPct: 38, widthPct: 38, heightPct: 28 },
  gridBottomLeft: { xPct: 29, yPct: 70, widthPct: 38, heightPct: 28 },
  gridBottomRight: { xPct: 71, yPct: 70, widthPct: 38, heightPct: 28 },
  centerStage: { xPct: 50, yPct: 56, widthPct: 76, heightPct: 58 },
};

export interface PlacementInput {
  layoutSlot?: LayoutSlot;
  position?: { xPct?: number; yPct?: number };
  size?: { widthPct?: number; heightPct?: number };
}

/**
 * Resolves placement from a layout slot.
 * Explicit position.xPct / position.yPct / size.widthPct / size.heightPct
 * ALWAYS win over the slot. `used` is true when at least one value came from the slot.
 */
export function resolveLayoutSlot(layer: PlacementInput): {
  position: { xPct?: number; yPct?: number };
  size: { widthPct?: number; heightPct?: number };
  used: boolean;
} {
  const box = layer.layoutSlot ? LAYOUT_SLOT_BOXES[layer.layoutSlot] : undefined;
  let used = false;

  const position: { xPct?: number; yPct?: number } = {};
  if (layer.position?.xPct !== undefined) {
    position.xPct = layer.position.xPct;
  } else if (box) {
    position.xPct = box.xPct;
    used = true;
  }

  if (layer.position?.yPct !== undefined) {
    position.yPct = layer.position.yPct;
  } else if (box) {
    position.yPct = box.yPct;
    used = true;
  }

  const size: { widthPct?: number; heightPct?: number } = {};
  if (layer.size?.widthPct !== undefined) {
    size.widthPct = layer.size.widthPct;
  } else if (box) {
    size.widthPct = box.widthPct;
    used = true;
  }

  if (layer.size?.heightPct !== undefined) {
    size.heightPct = layer.size.heightPct;
  } else if (box) {
    size.heightPct = box.heightPct;
    used = true;
  }

  return {
    position,
    size,
    used,
  };
}
