import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ImageProcessorService } from "../src/image-processor.js";

describe("ImageProcessorService", () => {
  const service = new ImageProcessorService();

  async function createTestImage(width = 200, height = 100, bg = { r: 255, g: 0, b: 0, alpha: 1 }) {
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: bg,
      },
    })
      .png()
      .toBuffer();
  }

  it("coverResize resizes to specified dimensions", async () => {
    const input = await createTestImage(200, 100);
    const result = await service.coverResize(input, { width: 320, height: 240 });
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
  });

  it("crop16x9 scales to 16:9 canvas (default 1920x1080)", async () => {
    const input = await createTestImage(500, 500);
    const result = await service.crop16x9(input);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
  });

  it("crop16x9 respects custom dimensions", async () => {
    const input = await createTestImage(500, 500);
    const result = await service.crop16x9(input, { width: 1280, height: 720 });
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);
  });

  it("colorGrade adjusts brightness and saturation and applies tint", async () => {
    const input = await createTestImage(50, 50, { r: 100, g: 100, b: 100, alpha: 1 });
    const result = await service.colorGrade(input, {
      brightness: 1.2,
      saturation: 1.5,
      tintHex: "#ff8800",
    });
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(50);
    expect(meta.height).toBe(50);
  });

  it("removeBackground makes matching key pixels transparent with feathered alpha", async () => {
    // White 10x10 square
    const input = await createTestImage(10, 10, { r: 255, g: 255, b: 255, alpha: 1 });
    const result = await service.removeBackground(input, {
      threshold: 50,
      featherPx: 5,
      keyColorHex: "#ffffff",
    });
    const raw = await sharp(result).raw().toBuffer();
    // Channels: R, G, B, A. Alpha should be 0 for exact match
    expect(raw[3]).toBe(0);
  });

  it("generateScrim creates transparent gradient overlays in all directions", async () => {
    for (const dir of ["left", "right", "top", "bottom", "full", "radial"] as const) {
      const result = await service.generateScrim({
        direction: dir,
        width: 100,
        height: 100,
        color: "#000000",
        opacity: 0.8,
      });
      const meta = await sharp(result).metadata();
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(100);
      expect(meta.channels).toBe(4);
    }
  });

  it("process pipeline executes full chain of operations", async () => {
    const input = await createTestImage(200, 200, { r: 255, g: 255, b: 255, alpha: 1 });
    const result = await service.process(input, {
      coverResize: { width: 100, height: 100 },
      colorGrade: { brightness: 1.1 },
    });
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });
});
