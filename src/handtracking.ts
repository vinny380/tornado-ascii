// Webcam hand tracking via MediaPipe. Owns the camera stream + the
// HandLandmarker model, runs detection on its own rAF loop, and exposes the
// index-fingertip position as a screen-space target. Deliberately isolated:
// main.ts only ever calls start()/stop()/getTarget() and never touches
// MediaPipe directly. Returns null when no hand is on screen so the caller can
// fall back to its idle behaviour rather than freezing.

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { assignRoles } from "./handroles";

// WASM build must match the installed @mediapipe/tasks-vision version.
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const INDEX_TIP = 8; // MediaPipe hand landmark: tip of the index finger
const WRIST = 0; // base of the palm
const INDEX_MCP = 5; // knuckle where the index finger meets the palm

// Depth is inferred from on-screen hand span (wrist→index-knuckle). A hand near
// the camera looks bigger; far away it looks smaller. These are the spans
// (in image-height units) that map to fully-near (1) and fully-far (0).
const SPAN_NEAR = 0.3;
const SPAN_FAR = 0.13;
const SPAN_SMOOTH = 0.3; // EMA factor on raw span — tames per-frame jitter
const COLOR_SMOOTH = 0.3; // EMA factor on the color hand's height

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** x,y in screen pixels; depth in 0 (hand far) .. 1 (hand near the camera). */
export type Point = { x: number; y: number; depth: number };

export class HandTracker {
  private video: HTMLVideoElement;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private lastVideoTime = -1;
  private target: Point | null = null;
  private spanEMA = -1; // smoothed hand span; -1 = not yet seeded
  private colorY: number | null = null; // control hand height, 0 (top)..1 (bottom)
  private colorYEMA = -1;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  /** Latest fingertip position in screen pixels, or null if no hand is seen. */
  getTarget(): Point | null {
    return this.target;
  }

  /** Color hand height (0 top .. 1 bottom), or null when no second hand is up. */
  getColorY(): number | null {
    return this.colorY;
  }

  /**
   * Open the camera, load the model, and begin detection. Throws on permission
   * denial / missing camera / model load failure so the caller can revert the
   * mode toggle and notify the user.
   */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    if (!this.landmarker) {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
    }

    this.running = true;
    this.lastVideoTime = -1;
    requestAnimationFrame(this.loop);
  }

  /** Stop detection and release the camera. Safe to call when already stopped. */
  stop(): void {
    this.running = false;
    this.target = null;
    this.colorY = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  private loop = (): void => {
    if (!this.running || !this.landmarker) return;
    const v = this.video;
    // Only run detection on fresh frames (readyState >= 2 == HAVE_CURRENT_DATA).
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const res = this.landmarker.detectForVideo(v, performance.now());
      const hands = res.landmarks ?? [];
      if (hands.length) {
        const labels = (res.handednesses ?? []).map(
          (h) => h?.[0]?.categoryName ?? "",
        );
        const { steer, color } = assignRoles(labels);
        const hand = hands[steer];
        const tip = hand[INDEX_TIP];

        // Hand span as a depth proxy. Normalize x by the video's aspect ratio
        // so the span is measured in consistent (image-height) units.
        const aspect = (v.videoWidth || 4) / (v.videoHeight || 3);
        const w0 = hand[WRIST];
        const w5 = hand[INDEX_MCP];
        const span = Math.hypot((w5.x - w0.x) * aspect, w5.y - w0.y);
        this.spanEMA =
          this.spanEMA < 0
            ? span
            : this.spanEMA + (span - this.spanEMA) * SPAN_SMOOTH;
        const depth = clamp01(
          (this.spanEMA - SPAN_FAR) / (SPAN_NEAR - SPAN_FAR),
        );

        // The video is mirrored in CSS (selfie view), so mirror x to match:
        // moving your hand right moves the tornado right.
        this.target = {
          x: (1 - tip.x) * window.innerWidth,
          y: tip.y * window.innerHeight,
          depth,
        };

        // Second hand (if any) drives the color sweep via its wrist height.
        if (color != null) {
          const cy = hands[color][WRIST].y;
          this.colorYEMA =
            this.colorYEMA < 0
              ? cy
              : this.colorYEMA + (cy - this.colorYEMA) * COLOR_SMOOTH;
          this.colorY = clamp01(this.colorYEMA);
        } else {
          this.colorY = null;
          this.colorYEMA = -1;
        }
      } else {
        this.target = null;
        this.spanEMA = -1; // re-seed when the hand returns
        this.colorY = null;
        this.colorYEMA = -1;
      }
    }
    requestAnimationFrame(this.loop);
  };
}
