import "./style.css";
import { Spine } from "./spine";
import { Tornado } from "./tornado";
import { Renderer } from "./renderer";
import { Embers } from "./embers";
import { Director } from "./director";
import { sampleImage, type ShapeSample } from "./morph";
import { state } from "./state";
import { initControls } from "./controls";
import { HandTracker } from "./handtracking";

const PARTICLE_COUNT = 20000;
const SPINE_NODES = 24;
const IDLE_SEC = 2.5; // after this with no mouse, the showreel auto-drives the tip
const MORPH_K = 8; // morph easing rate (higher = snappier dissolve)

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new Renderer(canvas);

const camVideo = document.getElementById("cam") as HTMLVideoElement;
const hands = new HandTracker(camVideo);

const toastEl = document.getElementById("toast") as HTMLElement;
let toastTimer = 0;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 3200);
}

const funnelHeight = () => window.innerHeight * 0.58;
// Base (depth-neutral) dimensions; video depth mode scales around these.
const baseMaxRadius = () =>
  Math.min(window.innerWidth, window.innerHeight) * 0.22;
const baseSegLen = () => funnelHeight() / (SPINE_NODES - 1);

const spine = new Spine(
  SPINE_NODES,
  funnelHeight() / (SPINE_NODES - 1),
  window.innerWidth / 2,
  window.innerHeight / 2,
);
const tornado = new Tornado(PARTICLE_COUNT);
const embers = new Embers();
const director = new Director();
director.t = 6;

// ---- Slideshow state ------------------------------------------------------
const slides: ShapeSample[] = [];
let index = 0; // currently shown slide
let savedIndex = 0; // where to resume after X
let active = false; // is the slideshow forming an image right now?
let current: ShapeSample | null = null; // the sample currently mapped to targets
let pending = -1; // slide to swap in once the dissolve bottoms out
let morph = 0; // actual morph fed to the tornado
let morphTarget = 0; // what morph eases toward

function applyTargets(sample: ShapeSample) {
  current = sample;
  const scale = Math.min(window.innerWidth, window.innerHeight) * 0.62;
  tornado.setTargets(sample, window.innerWidth / 2, window.innerHeight * 0.46, scale);
}

function sizing() {
  spine.setSegLen(funnelHeight() / (SPINE_NODES - 1));
  tornado.maxRadius = Math.min(window.innerWidth, window.innerHeight) * 0.22;
  if (current) applyTargets(current); // keep the form centered on resize
}
sizing();

function updateStatus() {
  if (!slides.length) {
    ui.setStatus("drop images anywhere, or add above");
  } else if (active) {
    ui.setStatus(`image ${index + 1} / ${slides.length} — playing`);
  } else {
    ui.setStatus(`${slides.length} loaded — paused · press R to resume`);
  }
}

// Show a slide with a storm-dissolve transition: ease morph down, swap the
// target at the bottom, ease back up into the new image.
function show(i: number) {
  if (!slides.length) return;
  index = ((i % slides.length) + slides.length) % slides.length;
  active = true;
  pending = index;
  morphTarget = 0; // dissolve out first; the swap happens in the frame loop
  updateStatus();
}

function exitSlideshow() {
  if (!active) return;
  savedIndex = index;
  active = false;
  pending = -1;
  morphTarget = 0; // scatter back into the storm
  updateStatus();
}

function resumeSlideshow() {
  if (!slides.length || active) return;
  show(savedIndex);
}

function loadImageFiles(files: File[]) {
  const picked = files.filter((f) => f.type.startsWith("image/")).slice(0, 10);
  if (!picked.length) return;
  Promise.all(
    picked.map(
      (f) =>
        new Promise<ShapeSample | null>((res) => {
          const url = URL.createObjectURL(f);
          const img = new Image();
          img.onload = () => {
            res(sampleImage(img, PARTICLE_COUNT));
            URL.revokeObjectURL(url);
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            res(null);
          };
          img.src = url;
        }),
    ),
  ).then((samples) => {
    slides.length = 0;
    for (const s of samples) if (s) slides.push(s);
    if (!slides.length) return;
    savedIndex = 0;
    show(0);
  });
}

// ---- Input ----------------------------------------------------------------
let clock = 0;
const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let lastMove = -999;
let depthEased = 0.5; // smoothed hand depth (0 far .. 1 near), video mode only
window.addEventListener("pointermove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  lastMove = clock;
});
window.addEventListener("resize", () => {
  renderer.resize();
  sizing();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") {
    if (active) show(index + 1);
  } else if (e.key === "ArrowLeft") {
    if (active) show(index - 1);
  } else if (e.key === "x" || e.key === "X") {
    exitSlideshow();
  } else if (e.key === "r" || e.key === "R") {
    resumeSlideshow();
  }
});

// Drag-and-drop images anywhere to load the slideshow.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length) loadImageFiles(files);
});

let gradientDirty = false;
function applyTheme() {
  document.body.classList.toggle("dark", state.dark);
}

const ui = initControls({
  onGradientChange: () => (gradientDirty = true),
  getCinematic: () => director.cinematic,
  setCinematic: (v) => (director.cinematic = v),
  getDark: () => state.dark,
  setDark: (v) => {
    state.dark = v;
    applyTheme();
  },
  getVideo: () => state.video,
  setVideo: setVideoMode,
  onImageFiles: loadImageFiles,
});

// Enter/leave video mode: start or stop the webcam hand tracker and flip the
// layered look. Returns the actual resulting state (false if the camera could
// not start) so the toggle UI can stay in sync.
async function setVideoMode(on: boolean): Promise<boolean> {
  if (on === state.video) return state.video;
  if (on) {
    try {
      await hands.start();
    } catch (err) {
      console.warn("Hand tracking failed to start:", err);
      toast("Camera unavailable — check permissions");
      return false;
    }
    state.video = true;
    document.body.classList.add("video-mode");
    toast("Point your index finger to steer the storm");
  } else {
    hands.stop();
    state.video = false;
    document.body.classList.remove("video-mode");
    // Restore depth-neutral size/intensity left over from video mode.
    tornado.intensity = 1;
    sizing();
  }
  return state.video;
}
applyTheme();
updateStatus();

// ?record=1 -> hide UI for clean capture.
if (new URLSearchParams(location.search).has("record")) {
  document.body.classList.add("recording");
}

let last = performance.now();
function frame(now: number) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switches) so nothing lurches
  clock += dt;

  if (gradientDirty) {
    renderer.rebuildLut();
    gradientDirty = false;
  }

  director.update(dt);

  // Ease the morph; swap to the pending slide once the dissolve bottoms out.
  morph += (morphTarget - morph) * (1 - Math.exp(-MORPH_K * dt));
  if (pending >= 0 && morph < 0.12) {
    applyTargets(slides[pending]);
    pending = -1;
    morphTarget = 1;
  }
  tornado.morph = morph;

  let idle = clock - lastMove > IDLE_SEC;
  let target = { x: mouse.x, y: mouse.y };
  let brightBoost = 1;
  if (state.video) {
    const finger = hands.getTarget();
    if (finger) {
      target = finger; // index fingertip drives the tip
      idle = false; // a hand is present — suppress the idle auto-sweep
    }
    // No hand detected: fall through to mouse / cinematic idle below so the
    // storm keeps moving instead of freezing.

    // Depth: ease toward the hand's distance (neutral 0.5 when no hand), then
    // map it to size + churn + glow so the storm looms as it nears the camera.
    const d = finger ? finger.depth : 0.5;
    depthEased += (d - depthEased) * (1 - Math.exp(-5 * dt));
    const sizeMul = 0.65 + 0.85 * depthEased; // ~0.65× (far) .. 1.5× (near)
    tornado.maxRadius = baseMaxRadius() * sizeMul;
    spine.setSegLen(baseSegLen() * sizeMul);
    tornado.intensity = 0.85 + 0.7 * depthEased; // spins harder up close
    brightBoost = 1 + 0.4 * depthEased; // and glows brighter
  }
  if (director.cinematic && idle) {
    target = director.autoTarget(window.innerWidth, window.innerHeight, morph);
  }
  spine.setTarget(target.x, target.y);
  spine.update(dt);

  tornado.update(dt, spine, director.loopT);
  embers.update(dt, tornado, state.speed);

  const globalBright =
    (0.9 + 0.1 * Math.sin(Math.PI * 2 * director.loopT)) * brightBoost;
  renderer.render(tornado, embers, globalBright);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
