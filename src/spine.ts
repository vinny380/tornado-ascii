// The follow physics — the heart of the effect.
//
// A spine is a vertical chain of nodes. Node 0 is the TIP (bottom of the
// funnel) and eases toward the mouse. Every node above it eases toward the
// node directly below it, offset upward by one segment length. Because each
// link lags slightly, horizontal motion of the tip ripples up the chain and
// the body trails behind it — "tip follows mouse, body follows tip".
//
// Easing uses frame-rate-independent exponential smoothing
// (alpha = 1 - e^(-k*dt)), which is smooth and never overshoots.

export interface SpineNode {
  x: number;
  y: number;
}

// Responsiveness constants (1/seconds). Higher = snappier.
const TIP_K = 6.5; // tip chasing the mouse — smooth but responsive
const BODY_K = 5.5; // each body link chasing its parent — a touch slower, so it trails

export class Spine {
  nodes: SpineNode[] = [];
  count: number;
  segLen: number;
  private target = { x: 0, y: 0 };

  constructor(count: number, segLen: number, startX: number, startY: number) {
    this.count = count;
    this.segLen = segLen;
    for (let i = 0; i < count; i++) {
      this.nodes.push({ x: startX, y: startY - i * segLen });
    }
    this.target.x = startX;
    this.target.y = startY;
  }

  setSegLen(s: number) {
    this.segLen = s;
  }

  setTarget(x: number, y: number) {
    this.target.x = x;
    this.target.y = y;
  }

  update(dt: number) {
    const tipA = 1 - Math.exp(-TIP_K * dt);
    const bodyA = 1 - Math.exp(-BODY_K * dt);

    const tip = this.nodes[0];
    tip.x += (this.target.x - tip.x) * tipA;
    tip.y += (this.target.y - tip.y) * tipA;

    for (let i = 1; i < this.count; i++) {
      const prev = this.nodes[i - 1];
      const node = this.nodes[i];
      const tx = prev.x;
      const ty = prev.y - this.segLen;
      node.x += (tx - node.x) * bodyA;
      node.y += (ty - node.y) * bodyA;
    }
  }

  /** Position along the spine for height h in [0,1] (0 = tip, 1 = top). */
  pointAt(h: number): { x: number; y: number } {
    // Clamp defensively: `!(h >= 0)` also catches NaN, so a bad height can
    // never index past the node array and throw.
    let hc = h;
    if (!(hc >= 0)) hc = 0;
    else if (hc > 1) hc = 1;
    const idxF = hc * (this.count - 1);
    const i0 = Math.floor(idxF);
    const i1 = Math.min(i0 + 1, this.count - 1);
    const f = idxF - i0;
    const a = this.nodes[i0];
    const b = this.nodes[i1];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
}
