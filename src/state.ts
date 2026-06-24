// Shared, mutable runtime config. Controls write to it; the render loop reads
// it every frame. Kept deliberately simple — no framework, just an object.

export interface GradientStop {
  /** Position along the gradient, 0..1. */
  pos: number;
  /** Hex color string, e.g. "#ff0080". */
  color: string;
}

export interface State {
  /** Vortex rotation multiplier. 0 = frozen, higher = faster spin. */
  speed: number;
  /** Editable color gradient sampled per-particle. */
  gradient: GradientStop[];
  /** false = soft light background; true = black background with additive glow. */
  dark: boolean;
}

// Default palette: warm orange ramp, tuned to read on a soft off-white bg.
export const state: State = {
  speed: 1,
  dark: false,
  gradient: [
    { pos: 0.0, color: "#9a3412" },
    { pos: 0.33, color: "#ea580c" },
    { pos: 0.66, color: "#f97316" },
    { pos: 1.0, color: "#fb923c" },
  ],
};
