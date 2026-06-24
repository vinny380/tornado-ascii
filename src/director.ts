// Keeps the storm feeling alive: a real-time loop clock (drives the seamless
// color cycle) and an idle auto-sweep of the tip. The morph itself is owned by
// the slideshow in main.

export const PERIOD = 15; // seconds per loop

export class Director {
  t = 0;
  loopT = 0;
  cinematic = true; // when on, the tip auto-sweeps while the mouse is idle

  update(dt: number) {
    this.t += dt;
    this.loopT = (this.t % PERIOD) / PERIOD;
  }

  /** Where the tip aims when the mouse is idle; centers as the form gathers. */
  autoTarget(w: number, h: number, morph: number): { x: number; y: number } {
    const lt = this.loopT;
    const twoPi = Math.PI * 2;
    const sweepX = Math.sin(twoPi * lt) * w * 0.2;
    const sweepY = Math.sin(twoPi * 2 * lt) * h * 0.1;
    return {
      x: w / 2 + sweepX * (1 - morph),
      y: h * 0.5 + sweepY * (1 - morph),
    };
  }
}
