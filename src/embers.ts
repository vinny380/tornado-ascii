import type { Tornado } from "./tornado";

// Sparks flung off the spinning tip that drift up into the black — the
// Death Stranding suspended-ash look. A small fixed pool of free particles
// with real velocity + drag + buoyancy, drawn additively.

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  colorT: number;
  size: number;
}

const MAX = 340;

export class Embers {
  private pool: Ember[] = [];
  private spawnAcc = 0;

  update(dt: number, tornado: Tornado, speed: number) {
    // Spawn rate scales with how hard the storm is spinning.
    this.spawnAcc += dt * 90 * speed;
    let tries = 0;
    while (this.spawnAcc >= 1 && this.pool.length < MAX && tries < 40) {
      this.spawnAcc -= 1;
      tries++;
      this.spawn(tornado, speed);
    }

    for (const e of this.pool) {
      const drag = Math.exp(-1.4 * dt);
      e.vx *= drag;
      e.vy *= drag;
      e.vy -= 26 * dt; // buoyancy: sucked upward
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.life -= dt;
    }
    this.pool = this.pool.filter((e) => e.life > 0);
  }

  private spawn(tornado: Tornado, speed: number) {
    const parts = tornado.particles;
    // Find a particle near the tip to launch from.
    let p = null;
    for (let i = 0; i < 6; i++) {
      const cand = parts[(Math.random() * parts.length) | 0];
      if (cand.h < 0.32) {
        p = cand;
        break;
      }
    }
    if (!p) return;
    const tangential = (60 + Math.random() * 120) * (0.5 + speed * 0.5);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const life = 0.7 + Math.random() * 1.3;
    this.pool.push({
      x: p.x,
      y: p.y,
      vx: dir * tangential,
      vy: -20 - Math.random() * 50,
      life,
      maxLife: life,
      colorT: p.colorT,
      size: Math.random() < 0.25 ? 2 : 1,
    });
  }

  /** Draw under an already-additive ctx. */
  draw(ctx: CanvasRenderingContext2D, lut: Uint8ClampedArray, lutSize: number) {
    for (const e of this.pool) {
      const t = e.colorT - Math.floor(e.colorT);
      const idx = Math.min(lutSize - 1, (t * lutSize) | 0) * 3;
      const a = e.life / e.maxLife;
      ctx.fillStyle = `rgba(${lut[idx]},${lut[idx + 1]},${lut[idx + 2]},${a})`;
      ctx.fillRect(e.x, e.y, e.size, e.size);
    }
  }
}
