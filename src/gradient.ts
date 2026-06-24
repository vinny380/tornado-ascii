import type { GradientStop } from "./state";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const int = parseInt(n, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Sample the gradient at position `t` (0..1, values outside wrap around).
 * Stops are sorted defensively so the editor can reorder them freely.
 */
export function sampleGradient(stops: GradientStop[], t: number): RGB {
  const tt = t - Math.floor(t); // wrap into [0,1)
  if (stops.length === 0) return { r: 255, g: 255, b: 255 };
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  if (tt <= sorted[0].pos) return hexToRgb(sorted[0].color);
  const last = sorted[sorted.length - 1];
  if (tt >= last.pos) return hexToRgb(last.color);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (tt >= a.pos && tt <= b.pos) {
      const span = b.pos - a.pos || 1;
      const f = (tt - a.pos) / span;
      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);
      return {
        r: ca.r + (cb.r - ca.r) * f,
        g: ca.g + (cb.g - ca.g) * f,
        b: ca.b + (cb.b - ca.b) * f,
      };
    }
  }
  return hexToRgb(last.color);
}

/**
 * Precompute a flat RGB lookup table so the hot render loop can sample colors
 * with a single array index instead of re-parsing hex + sorting every frame.
 * Rebuilt only when the gradient actually changes.
 */
export function buildLut(stops: GradientStop[], size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * 3);
  for (let i = 0; i < size; i++) {
    const c = sampleGradient(stops, i / size);
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
}
