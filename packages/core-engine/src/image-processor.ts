import sharp from "sharp";

export interface Crop16x9Options {
  width?: number; // target width, default 1920
  height?: number; // target height, default 1080
}

export interface CoverResizeOptions {
  width: number;
  height: number;
  position?: string;
}

export interface ColorGradeOptions {
  brightness?: number; // 0..2, 1 = unchanged
  saturation?: number; // 0..2, 1 = unchanged
  tintHex?: string; // hex color string, e.g. "#d4af37"
}

export interface RemoveBackgroundOptions {
  mode?: "luminance" | "colorKey"; // default "luminance"
  threshold?: number; // 0..255, default 230 for light background
  featherPx?: number; // 1..30, default 8
  keyColorHex?: string; // e.g. "#ffffff" or "#000000"
}

export interface GenerateScrimOptions {
  width?: number; // default 1920
  height?: number; // default 1080
  direction: "left" | "right" | "bottom" | "top" | "full" | "radial";
  color?: string; // default "#000000"
  opacity?: number; // 0..1, default 0.75
}

export interface ProcessImageOptions {
  crop16x9?: boolean | Crop16x9Options;
  coverResize?: CoverResizeOptions;
  colorGrade?: ColorGradeOptions;
  removeBackground?: boolean | RemoveBackgroundOptions;
  generateScrim?: GenerateScrimOptions;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0]! + clean[0]!, 16),
      parseInt(clean[1]! + clean[1]!, 16),
      parseInt(clean[2]! + clean[2]!, 16),
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

/**
 * ImageProcessorService — SRP service dedicated to deterministic asset image transformation.
 * Uses sharp for high-performance in-memory processing.
 */
export class ImageProcessorService {
  /**
   * Resizes an image to fill specified dimensions using cover cropping.
   */
  async coverResize(input: Buffer, opts: CoverResizeOptions): Promise<Buffer> {
    return sharp(input)
      .resize(opts.width, opts.height, {
        fit: "cover",
        position: opts.position ?? "center",
      })
      .toBuffer();
  }

  /**
   * Crops/scales an image to standard 16:9 composition canvas (default 1920x1080).
   */
  async crop16x9(input: Buffer, opts?: Crop16x9Options): Promise<Buffer> {
    const width = opts?.width ?? 1920;
    const height = opts?.height ?? 1080;
    return this.coverResize(input, { width, height });
  }

  /**
   * Applies color adjustments and tinting.
   */
  async colorGrade(input: Buffer, opts: ColorGradeOptions): Promise<Buffer> {
    let pipeline = sharp(input);
    if (opts.brightness !== undefined || opts.saturation !== undefined) {
      const modulateOpts: { brightness?: number; saturation?: number } = {};
      if (opts.brightness !== undefined) modulateOpts.brightness = opts.brightness;
      if (opts.saturation !== undefined) modulateOpts.saturation = opts.saturation;
      pipeline = pipeline.modulate(modulateOpts);
    }
    if (opts.tintHex) {
      const [r, g, b] = hexToRgb(opts.tintHex);
      pipeline = pipeline.tint({ r, g, b });
    }
    return pipeline.toBuffer();
  }

  /**
   * Removes background using color-key or luminance thresholding with feathered edge transition.
   */
  async removeBackground(input: Buffer, opts?: RemoveBackgroundOptions): Promise<Buffer> {
    const threshold = opts?.threshold ?? 230;
    const feather = Math.max(1, opts?.featherPx ?? 8);
    const [kr = 255, kg = 255, kb = 255] = opts?.keyColorHex ? hexToRgb(opts.keyColorHex) : [255, 255, 255];

    const image = sharp(input).ensureAlpha();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

    const totalPixels = info.width * info.height;
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;

      // Euclidean distance in RGB color space
      const dr = r - kr;
      const dg = g - kg;
      const db = b - kb;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);

      if (dist < threshold) {
        if (dist <= threshold - feather) {
          data[idx + 3] = 0; // Fully transparent
        } else {
          // Feathered alpha transition
          const factor = (dist - (threshold - feather)) / feather;
          data[idx + 3] = Math.round((data[idx + 3]! * factor));
        }
      }
    }

    return sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  /**
   * Generates a smooth documentary gradient scrim PNG.
   */
  async generateScrim(opts: GenerateScrimOptions): Promise<Buffer> {
    const width = opts.width ?? 1920;
    const height = opts.height ?? 1080;
    const color = opts.color ?? "#000000";
    const opacity = Math.min(1, Math.max(0, opts.opacity ?? 0.75));

    let svg = "";
    switch (opts.direction) {
      case "left":
        svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="scrim" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="${color}" stop-opacity="${opacity}" />
              <stop offset="100%" stop-color="${color}" stop-opacity="0" />
            </linearGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#scrim)" />
        </svg>`;
        break;
      case "right":
        svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="scrim" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stop-color="${color}" stop-opacity="${opacity}" />
              <stop offset="100%" stop-color="${color}" stop-opacity="0" />
            </linearGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#scrim)" />
        </svg>`;
        break;
      case "top":
        svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="scrim" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="${color}" stop-opacity="${opacity}" />
              <stop offset="100%" stop-color="${color}" stop-opacity="0" />
            </linearGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#scrim)" />
        </svg>`;
        break;
      case "radial":
        svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="scrim" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="${color}" stop-opacity="0" />
              <stop offset="100%" stop-color="${color}" stop-opacity="${opacity}" />
            </radialGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#scrim)" />
        </svg>`;
        break;
      case "full":
        svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${color}" fill-opacity="${opacity}" />
        </svg>`;
        break;
      case "bottom":
      default:
        svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="scrim" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stop-color="${color}" stop-opacity="${opacity}" />
              <stop offset="100%" stop-color="${color}" stop-opacity="0" />
            </linearGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#scrim)" />
        </svg>`;
        break;
    }

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Applies the full requested processing chain in a pipeline.
   */
  async process(input: Buffer | null, options: ProcessImageOptions): Promise<Buffer> {
    let current: Buffer;
    if (options.generateScrim) {
      current = await this.generateScrim(options.generateScrim);
    } else {
      if (!input) {
        throw new Error("Input buffer is required when not generating a scrim");
      }
      current = input;
    }

    if (options.crop16x9) {
      const opts = typeof options.crop16x9 === "object" ? options.crop16x9 : {};
      current = await this.crop16x9(current, opts);
    }

    if (options.coverResize) {
      current = await this.coverResize(current, options.coverResize);
    }

    if (options.removeBackground) {
      const opts = typeof options.removeBackground === "object" ? options.removeBackground : {};
      current = await this.removeBackground(current, opts);
    }

    if (options.colorGrade) {
      current = await this.colorGrade(current, options.colorGrade);
    }

    return current;
  }
}
