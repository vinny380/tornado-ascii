import type { Spine } from "./spine";
import type { ShapeSample } from "./morph";
import { state } from "./state";

// A cloud of independent particles orbiting the spine axis. Each particle has
// a fixed height on the funnel; every frame it sits at the spine point for
// that height plus a rotating radial offset. Radius grows with height, so the
// silhouette is a vortex: thin at the tip, flared at top.
//
// When `morph` > 0 the particles lerp from their vortex position toward a
// per-particle target (a sampled shape, e.g. a skull) — the Eye of the Storm.

export interface Particle {
  h: number; // height on funnel, 0 (tip) .. 1 (top)
  angle: number; // current orbit angle
  spin: number; // per-particle spin multiplier (organic variation)
  vh: number; // vertical flow speed (h-units/sec) — the updraft
  ripplePhase: number;
  turbPhase: number;
  gRand: number; // stable randomness for glyph variation

  // Recomputed each frame:
  x: number;
  y: number;
  front: number; // 0 (back of orbit) .. 1 (front), for depth shading + draw order
  fade: number; // edge fade (0 at funnel ends, 1 in the body) to hide recycling
  colorT: number; // gradient sample position
  colorMix: number; // 0..1 blend toward the target color (image morphs only)
  cr: number; // target color (0..255), used when colorMix > 0
  cg: number;
  cb: number;
}

// Vertical squash of the orbit ellipse — fakes a 3D ring seen from the side.
const ELLIPSE_Y = 0.32;

export class Tornado {
  particles: Particle[] = [];
  maxRadius = 200;
  time = 0;
  count: number;
  /** Extra churn multiplier (video depth mode pushes this up close). 1 = normal. */
  intensity = 1;

  // Morph state. `morph` is 0..1; targets are screen-space positions.
  morph = 0;
  targetX: Float32Array;
  targetY: Float32Array;
  targetLum: Float32Array;
  targetR: Float32Array;
  targetG: Float32Array;
  targetB: Float32Array;
  hasColorTargets = false; // true for image morphs -> render real photo colors
  validTargets = false; // false if the shape sampled to nothing -> skip morph
  private morphCx = 0; // center the formed image spins/sways around
  private morphCy = 0;

  constructor(count: number) {
    this.count = count;
    this.targetX = new Float32Array(count);
    this.targetY = new Float32Array(count);
    this.targetLum = new Float32Array(count);
    this.targetR = new Float32Array(count);
    this.targetG = new Float32Array(count);
    this.targetB = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.particles.push({
        h: Math.pow(Math.random(), 0.8),
        angle: Math.random() * Math.PI * 2,
        spin: 0.85 + Math.random() * 0.3,
        vh: 0.06 + Math.random() * 0.16,
        ripplePhase: Math.random() * Math.PI * 2,
        turbPhase: Math.random() * Math.PI * 2,
        gRand: Math.random(),
        x: 0,
        y: 0,
        front: 0,
        fade: 0,
        colorT: 0,
        colorMix: 0,
        cr: 255,
        cg: 255,
        cb: 255,
      });
    }
  }

  /** Map a normalized shape sample into screen-space morph targets. */
  setTargets(sample: ShapeSample, cx: number, cy: number, scale: number) {
    this.validTargets = sample.n > 0;
    if (!this.validTargets) return; // empty shape -> leave morph disabled
    this.morphCx = cx;
    this.morphCy = cy;
    this.hasColorTargets = !!sample.r;
    for (let i = 0; i < this.count; i++) {
      const j = i % sample.n;
      this.targetX[i] = cx + sample.x[j] * scale;
      this.targetY[i] = cy + sample.y[j] * scale;
      this.targetLum[i] = sample.lum[j];
      if (sample.r && sample.g && sample.b) {
        this.targetR[i] = sample.r[j];
        this.targetG[i] = sample.g[j];
        this.targetB[i] = sample.b[j];
      }
    }
  }

  private radiusAt(h: number): number {
    return this.maxRadius * (0.06 + 0.94 * Math.pow(h, 0.85));
  }

  update(dt: number, spine: Spine, colorPhase: number) {
    this.time += dt;
    const speed = state.speed * this.intensity;
    const time = this.time;
    const twoPi = Math.PI * 2;
    // No morph effect unless we actually have a shape to fly to.
    const m = this.validTargets ? this.morph : 0;
    // Damp the storm's churn as the form gathers, so the face can hold still.
    const motion = 1 - 0.85 * m;

    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];

      // Updraft: particles flow up the funnel and recycle at the bottom.
      p.h += p.vh * speed * dt * motion;
      if (!Number.isFinite(p.h) || p.h < 0) {
        p.h = p.gRand; // self-heal pathological values, never crash pointAt
      } else if (p.h > 1) {
        p.h -= 1;
        if (m < 0.4) p.angle = Math.random() * twoPi; // don't re-seed mid-morph
      }

      // Tornadoes spin faster where they are narrow — bump the rate near the tip.
      const spinRate = (1.4 / (0.35 + p.h * 0.9)) * p.spin * speed * motion;
      p.angle += spinRate * dt;

      // Travelling ripple up the funnel surface + turbulence shear on the
      // orbit angle — together these dissolve rigid rings into flowing swirl.
      const ripple = 1 + 0.16 * Math.sin(p.h * 5.0 - time * 1.8 + p.ripplePhase);
      const radius = this.radiusAt(p.h) * ripple;
      const turb = 0.28 * Math.sin(p.h * 4.0 + time * 1.1 + p.turbPhase);
      const a = p.angle + turb;

      const sp = spine.pointAt(p.h);
      const ca = Math.cos(a);
      const sa = Math.sin(a);

      let x = sp.x + ca * radius;
      let y = sp.y + sa * radius * ELLIPSE_Y;
      let front = (sa + 1) / 2;
      let fade = Math.min(1, Math.min(p.h, 1 - p.h) / 0.12);

      const angleNorm = a / twoPi;
      let colorT = 0.55 * p.h + 0.45 * (angleNorm - Math.floor(angleNorm)) + colorPhase;

      let colorMix = 0;
      if (m > 0.0001) {
        // Keep the formed image alive: sway the whole picture gently around
        // its center and let each speck orbit its target point a touch, so it
        // still reads as a churning vortex rather than a frozen photo.
        let tx = this.targetX[i];
        let ty = this.targetY[i];
        const dx = tx - this.morphCx;
        const dy = ty - this.morphCy;
        const sway = Math.sin(time * 0.6) * 0.11 * speed; // ±~6° breathing rotation
        const cosA = Math.cos(sway);
        const sinA = Math.sin(sway);
        tx = this.morphCx + dx * cosA - dy * sinA;
        ty = this.morphCy + dx * sinA + dy * cosA;
        const oa = time * 3 * speed + p.ripplePhase; // tiny per-speck orbit
        tx += Math.cos(oa) * 1.7;
        ty += Math.sin(oa) * 1.7;

        x += (tx - x) * m;
        y += (ty - y) * m;
        const lum = this.targetLum[i];
        fade = fade * (1 - m) + m; // form is fully opaque
        if (this.hasColorTargets) {
          // Photo morph: keep specks crisp (front-bucket) and tint to real color.
          front = front * (1 - m) + (0.55 + 0.45 * lum) * m;
          colorMix = m;
          p.cr = this.targetR[i];
          p.cg = this.targetG[i];
          p.cb = this.targetB[i];
        } else {
          // Glyph morph: self-shade through the gradient via luminance.
          front = front * (1 - m) + lum * m;
          colorT = colorT * (1 - m) + lum * m;
        }
      }

      p.x = x;
      p.y = y;
      p.front = front;
      p.fade = fade;
      p.colorT = colorT;
      p.colorMix = colorMix;
    }
  }
}
