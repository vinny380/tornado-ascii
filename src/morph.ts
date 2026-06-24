// Shape sampling for the morph. Two sources:
//   sampleGlyph — rasterize an emoji/text glyph; keep bright/opaque pixels so
//     interior dark regions (a skull's eye sockets) become holes.
//   sampleImage — rasterize an uploaded picture; keep every opaque pixel AND
//     its real color, so the storm can assemble into the actual photo.

export interface ShapeSample {
  x: Float32Array; // normalized, centered: -0.5 .. 0.5
  y: Float32Array; // normalized, centered: -0.5 .. 0.5 (y down)
  lum: Float32Array; // 0..1, for self-shading
  // Present only for images — real per-point color (0..255).
  r?: Float32Array;
  g?: Float32Array;
  b?: Float32Array;
  n: number;
}

const glyphCache = new Map<string, ShapeSample>();

function shuffleTake(
  xs: number[],
  ys: number[],
  ls: number[],
  rs: number[] | null,
  maxPoints: number,
): ShapeSample {
  const idx = xs.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const n = Math.min(idx.length, maxPoints);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const lum = new Float32Array(n);
  let r: Float32Array | undefined;
  let g: Float32Array | undefined;
  let b: Float32Array | undefined;
  if (rs) {
    r = new Float32Array(n);
    g = new Float32Array(n);
    b = new Float32Array(n);
  }
  for (let i = 0; i < n; i++) {
    const k = idx[i];
    x[i] = xs[k];
    y[i] = ys[k];
    lum[i] = ls[k];
    if (rs && r && g && b) {
      r[i] = rs[k * 3];
      g[i] = rs[k * 3 + 1];
      b[i] = rs[k * 3 + 2];
    }
  }
  return { x, y, lum, r, g, b, n };
}

export function sampleGlyph(glyph: string, maxPoints = 22000): ShapeSample {
  const cached = glyphCache.get(glyph);
  if (cached) return cached;

  const S = 260;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S, S);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.floor(S * 0.82)}px "Apple Color Emoji", "Segoe UI Emoji", system-ui, serif`;
  ctx.fillText(glyph, S / 2, S / 2);

  const data = ctx.getImageData(0, 0, S, S).data;

  // Primary pass keeps only bright pixels (so a skull's dark eye sockets
  // become real holes). If a glyph renders dark / as a fallback box / not at
  // all, that can leave too few points — then retry keeping every opaque pixel
  // so the morph target is never empty.
  const collect = (lumFloor: number) => {
    const xs: number[] = [];
    const ys: number[] = [];
    const ls: number[] = [];
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const o = (py * S + px) * 4;
        const a = data[o + 3];
        if (a < 40) continue;
        const lum =
          ((0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255) *
          (a / 255);
        if (lum < lumFloor) continue;
        xs.push(px / S - 0.5);
        ys.push(py / S - 0.5);
        ls.push(0.45 + 0.55 * lum);
      }
    }
    return { xs, ys, ls };
  };

  let pass = collect(0.3);
  if (pass.xs.length < 200) pass = collect(0); // fallback: any opaque pixel

  const sample = shuffleTake(pass.xs, pass.ys, pass.ls, null, maxPoints);
  glyphCache.set(glyph, sample);
  return sample;
}

export function sampleImage(
  img: HTMLImageElement | ImageBitmap,
  maxPoints = 30000,
): ShapeSample {
  const S = 480; // higher-res raster -> finer image detail in the ASCII
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S, S);

  // Fit the picture inside the square, preserving aspect (letterboxed).
  const iw = (img as HTMLImageElement).naturalWidth || (img as ImageBitmap).width;
  const ih = (img as HTMLImageElement).naturalHeight || (img as ImageBitmap).height;
  const scale = Math.min(S / iw, S / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (S - dw) / 2;
  const dy = (S - dh) / 2;
  ctx.drawImage(img as CanvasImageSource, dx, dy, dw, dh);

  const data = ctx.getImageData(0, 0, S, S).data;
  const xs: number[] = [];
  const ys: number[] = [];
  const ls: number[] = [];
  const rs: number[] = [];
  // Only sample inside the drawn rect so the black letterbox isn't included.
  const x0 = Math.max(0, Math.floor(dx));
  const x1 = Math.min(S, Math.ceil(dx + dw));
  const y0 = Math.max(0, Math.floor(dy));
  const y1 = Math.min(S, Math.ceil(dy + dh));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const o = (py * S + px) * 4;
      const a = data[o + 3];
      if (a < 40) continue; // respect PNG transparency; photos keep everything
      const R = data[o];
      const G = data[o + 1];
      const B = data[o + 2];
      const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
      xs.push(px / S - 0.5);
      ys.push(py / S - 0.5);
      ls.push(0.4 + 0.6 * lum);
      rs.push(R, G, B);
    }
  }

  return shuffleTake(xs, ys, ls, rs, maxPoints);
}
