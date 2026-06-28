import type { Tornado } from "./tornado";
import type { Embers } from "./embers";
import { buildLut } from "./gradient";
import { state } from "./state";

// Particles are drawn as tiny filled squares (fillRect) rather than glyphs.
// fillRect is ~4-5x cheaper than fillText, which is what lets us push tens of
// thousands of specks at 60fps. At 2-3px they read as the same fine grain.
const NEAR_SIZE = 2; // crisp near specks
const FAR_SIZE = 3; // far specks a touch bigger -> soft, out-of-focus

const LUT_SIZE = 360;
const TRAIL_FADE = 0.35; // higher = crisper, lower = longer comet trails
const DOF_SPLIT = 0.5; // particles below this `front` are "far" (hazy)
const SLATE = [58, 74, 106]; // cool tint mixed into far particles (dark theme)
const BG_DARK = [0, 0, 0];
const BG_LIGHT = [244, 242, 238]; // soft off-white, easy on the eyes
const BLOOM_SCALE = 0.5; // bloom buffer resolution factor
const BLOOM_THRESH = 0.6; // only the brightest front particles glow
const BLOOM_STRENGTH = 0.6;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private bloom: HTMLCanvasElement;
  private bloomCtx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private lut: Uint8ClampedArray;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.bloom = document.createElement("canvas");
    this.bloomCtx = this.bloom.getContext("2d")!;
    this.lut = buildLut(state.gradient, LUT_SIZE);
    this.resize();
  }

  get width() {
    return this.w;
  }
  get height() {
    return this.h;
  }

  rebuildLut() {
    this.lut = buildLut(state.gradient, LUT_SIZE);
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.bloom.width = Math.max(1, Math.floor(this.w * BLOOM_SCALE));
    this.bloom.height = Math.max(1, Math.floor(this.h * BLOOM_SCALE));
  }

  render(tornado: Tornado, embers: Embers, globalBright: number) {
    const ctx = this.ctx;
    const lut = this.lut;
    // Video mode forces the dark/additive look so the mist glows over the feed.
    const dark = state.dark || state.video;
    // Background the trails fade toward.
    const bg = dark ? BG_DARK : BG_LIGHT;

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (state.video) {
      // Fade the previous frame toward TRANSPARENT (not a bg color) so the
      // webcam shows through while particles still leave comet trails.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${TRAIL_FADE})`;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${TRAIL_FADE})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    const parts = tornado.particles;
    // Painter's algorithm: back (far) first, near on top.
    parts.sort((a, b) => a.front - b.front);

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const back = p.front < DOF_SPLIT;
      this.drawParticle(ctx, p, lut, globalBright, dark, bg, back);
    }

    if (dark) {
      // Additive glow stack only makes sense on black.
      ctx.globalCompositeOperation = "lighter";
      embers.draw(ctx, lut, LUT_SIZE);
      ctx.globalCompositeOperation = "source-over";
      this.drawBloom(parts, lut, globalBright);
    } else {
      // Light theme: drawn straight (source-over), no bloom.
      embers.draw(ctx, lut, LUT_SIZE);
    }
  }

  private drawParticle(
    ctx: CanvasRenderingContext2D,
    p: Tornado["particles"][number],
    lut: Uint8ClampedArray,
    globalBright: number,
    dark: boolean,
    bg: number[],
    back: boolean,
  ) {
    const t = p.colorT - Math.floor(p.colorT);
    const idx = Math.min(LUT_SIZE - 1, (t * LUT_SIZE) | 0) * 3;
    let r: number;
    let g: number;
    let b: number;
    let alpha: number;

    if (dark) {
      // Brightness encodes depth (dim = far); far gets a cool slate tint.
      const bright = (0.4 + 0.6 * p.front) * globalBright * (back ? 0.8 : 1);
      const mix = back ? 0.45 : 0;
      r = (lut[idx] * (1 - mix) + SLATE[0] * mix) * bright;
      g = (lut[idx + 1] * (1 - mix) + SLATE[1] * mix) * bright;
      b = (lut[idx + 2] * (1 - mix) + SLATE[2] * mix) * bright;
      alpha = (0.5 + 0.5 * p.front) * p.fade * (back ? 0.7 : 1);
    } else {
      // Light theme: full color, depth encoded by ALPHA (far fades into the
      // background). Far particles also blend toward bg for an airy haze.
      r = lut[idx] * globalBright;
      g = lut[idx + 1] * globalBright;
      b = lut[idx + 2] * globalBright;
      const toBg = back ? 0.4 : 0;
      r = r * (1 - toBg) + bg[0] * toBg;
      g = g * (1 - toBg) + bg[1] * toBg;
      b = b * (1 - toBg) + bg[2] * toBg;
      alpha = (0.2 + 0.55 * p.front) * p.fade * (back ? 0.8 : 1);
    }

    if (p.colorMix > 0) {
      const cm = p.colorMix;
      r = r * (1 - cm) + p.cr * globalBright * cm;
      g = g * (1 - cm) + p.cg * globalBright * cm;
      b = b * (1 - cm) + p.cb * globalBright * cm;
    }

    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
    const size = back ? FAR_SIZE : NEAR_SIZE;
    const half = size * 0.5;
    ctx.fillRect(p.x - half, p.y - half, size, size);
  }

  // Re-draw the bright particles into a small buffer, then blur + additively
  // composite it back. That halo is what makes flat ASCII read as luminous plasma.
  private drawBloom(
    parts: Tornado["particles"],
    lut: Uint8ClampedArray,
    globalBright: number,
  ) {
    const bctx = this.bloomCtx;
    bctx.globalCompositeOperation = "source-over";
    bctx.clearRect(0, 0, this.bloom.width, this.bloom.height);
    bctx.globalCompositeOperation = "lighter";
    const s = BLOOM_SCALE;

    for (const p of parts) {
      if (p.front < BLOOM_THRESH) continue;
      const t = p.colorT - Math.floor(p.colorT);
      const idx = Math.min(LUT_SIZE - 1, (t * LUT_SIZE) | 0) * 3;
      const a = p.front * p.front * p.fade * globalBright;
      let r = lut[idx];
      let g = lut[idx + 1];
      let b = lut[idx + 2];
      if (p.colorMix > 0) {
        const cm = p.colorMix;
        r = r * (1 - cm) + p.cr * cm;
        g = g * (1 - cm) + p.cg * cm;
        b = b * (1 - cm) + p.cb * cm;
      }
      bctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`;
      bctx.fillRect(p.x * s, p.y * s, 2, 2);
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = BLOOM_STRENGTH;
    ctx.filter = "blur(6px)";
    ctx.drawImage(this.bloom, 0, 0, this.w, this.h);
    ctx.filter = "none";
    ctx.restore();
  }
}
