import { state } from "./state";
import type { GradientStop } from "./state";
import { rgbToHex, sampleGradient } from "./gradient";

interface ControlOpts {
  /** Called whenever the gradient stops change (color, position, add, remove). */
  onGradientChange: () => void;
  getCinematic: () => boolean;
  setCinematic: (v: boolean) => void;
  getDark: () => boolean;
  setDark: (v: boolean) => void;
  getVideo: () => boolean;
  /** Toggle webcam hand-tracking. Async (camera + model load); resolves to the
   *  actual resulting state (false if start failed / was denied). */
  setVideo: (v: boolean) => Promise<boolean>;
  /** Up to 10 images dropped/picked to drive the slideshow. */
  onImageFiles: (files: File[]) => void;
}

export interface ControlHandle {
  /** Update the slideshow status line (image count / current index / mode). */
  setStatus: (text: string) => void;
}

const CHEVRON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

export function initControls(opts: ControlOpts): ControlHandle {
  const root = document.createElement("div");
  root.className = "panel";
  root.innerHTML = `
    <div class="panel-header">
      <div class="panel-title"><span class="dot"></span> TORNADO</div>
      <button class="collapse-btn" aria-label="Toggle panel">${CHEVRON}</button>
    </div>
    <div class="panel-body">
      <div class="control">
        <label>Gradient</label>
        <div class="gradient-editor">
          <div class="gradient-bar"></div>
          <div class="gradient-hint">click a stop to recolor · double-click bar to add · drag down to remove</div>
        </div>
      </div>
      <div class="control">
        <div class="control-row">
          <label>Speed</label>
          <span class="value speed-value"></span>
        </div>
        <input class="slider speed-slider" type="range" min="0" max="3" step="0.01" />
      </div>
      <div class="control">
        <div class="control-row">
          <label>Cinematic loop</label>
          <button class="toggle cine-toggle" role="switch"><span class="knob"></span></button>
        </div>
        <div class="gradient-hint">auto-sweep the tip when idle</div>
      </div>
      <div class="control">
        <div class="control-row">
          <label>Dark mode</label>
          <button class="toggle dark-toggle" role="switch"><span class="knob"></span></button>
        </div>
      </div>
      <div class="control">
        <div class="control-row">
          <label>Video mode</label>
          <button class="toggle video-toggle" role="switch"><span class="knob"></span></button>
        </div>
        <div class="gradient-hint">webcam on · steer the tip with your index finger</div>
      </div>
      <div class="control">
        <label>Slideshow</label>
        <button class="upload-btn">＋ Add images (up to 10)</button>
        <input class="file-input" type="file" accept="image/*" multiple hidden />
        <div class="slide-status gradient-hint">drop images anywhere, or add above</div>
        <div class="keyhint">
          <span><kbd>◀</kbd><kbd>▶</kbd> switch</span>
          <span><kbd>X</kbd> exit</span>
          <span><kbd>R</kbd> resume</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // --- Collapse / expand ---------------------------------------------------
  root
    .querySelector(".collapse-btn")!
    .addEventListener("click", () => root.classList.toggle("collapsed"));

  // --- Speed ---------------------------------------------------------------
  const speedSlider = root.querySelector(".speed-slider") as HTMLInputElement;
  const speedValue = root.querySelector(".speed-value") as HTMLElement;
  speedSlider.value = String(state.speed);
  const showSpeed = () => (speedValue.textContent = state.speed.toFixed(2) + "×");
  showSpeed();
  speedSlider.addEventListener("input", () => {
    state.speed = parseFloat(speedSlider.value);
    showSpeed();
  });

  // --- Cinematic toggle ----------------------------------------------------
  const cine = root.querySelector(".cine-toggle") as HTMLButtonElement;
  const syncCine = () =>
    cine.classList.toggle("on", opts.getCinematic());
  syncCine();
  cine.addEventListener("click", () => {
    opts.setCinematic(!opts.getCinematic());
    syncCine();
  });

  // --- Dark mode toggle ----------------------------------------------------
  const darkBtn = root.querySelector(".dark-toggle") as HTMLButtonElement;
  const syncDark = () => darkBtn.classList.toggle("on", opts.getDark());
  syncDark();
  darkBtn.addEventListener("click", () => {
    opts.setDark(!opts.getDark());
    syncDark();
  });

  // --- Video mode toggle ---------------------------------------------------
  const videoBtn = root.querySelector(".video-toggle") as HTMLButtonElement;
  const syncVideo = () => videoBtn.classList.toggle("on", opts.getVideo());
  syncVideo();
  let videoBusy = false;
  videoBtn.addEventListener("click", async () => {
    if (videoBusy) return; // ignore clicks while the camera spins up/down
    videoBusy = true;
    videoBtn.classList.add("busy");
    await opts.setVideo(!opts.getVideo()); // state updated by the caller
    videoBtn.classList.remove("busy");
    syncVideo();
    videoBusy = false;
  });

  // --- Slideshow images ----------------------------------------------------
  const uploadBtn = root.querySelector(".upload-btn") as HTMLButtonElement;
  const fileInput = root.querySelector(".file-input") as HTMLInputElement;
  const statusEl = root.querySelector(".slide-status") as HTMLElement;

  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    if (files.length) opts.onImageFiles(files);
    fileInput.value = ""; // allow re-selecting the same files
  });

  // --- Gradient editor -----------------------------------------------------
  const bar = root.querySelector(".gradient-bar") as HTMLElement;

  // One shared, hidden native color input, retargeted to the active stop.
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "hidden-color";
  document.body.appendChild(colorInput);
  let activeStop: GradientStop | null = null;
  colorInput.addEventListener("input", () => {
    if (!activeStop) return;
    activeStop.color = colorInput.value;
    refresh();
  });

  function gradientCss(): string {
    const sorted = [...state.gradient].sort((a, b) => a.pos - b.pos);
    return sorted.map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(", ");
  }

  function paintBar() {
    bar.style.background = `linear-gradient(to right, ${gradientCss()})`;
  }

  // Full rebuild: repaint bar + recreate handles. Used on add/remove/recolor.
  function refresh() {
    paintBar();
    bar.querySelectorAll(".stop").forEach((e) => e.remove());
    for (const stop of state.gradient) makeHandle(stop);
    opts.onGradientChange();
  }

  function makeHandle(stop: GradientStop) {
    const handle = document.createElement("div");
    handle.className = "stop";
    handle.style.left = stop.pos * 100 + "%";
    handle.style.setProperty("--c", stop.color);
    bar.appendChild(handle);

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;

    handle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

      const rect = bar.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      stop.pos = pos;
      handle.style.left = pos * 100 + "%";
      paintBar();

      const removable = dy > 40 && state.gradient.length > 2;
      handle.classList.toggle("removing", removable);
      opts.onGradientChange();
    });

    handle.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = e.clientY - startY;

      if (dy > 40 && state.gradient.length > 2) {
        const i = state.gradient.indexOf(stop);
        if (i >= 0) state.gradient.splice(i, 1);
        refresh();
        return;
      }
      if (!moved) {
        activeStop = stop;
        colorInput.value = stop.color;
        colorInput.click();
      }
      refresh();
    });

    // Don't let double-clicking a handle also add a new stop.
    handle.addEventListener("dblclick", (e) => e.stopPropagation());
  }

  bar.addEventListener("dblclick", (e) => {
    const rect = bar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const c = sampleGradient(state.gradient, pos);
    state.gradient.push({ pos, color: rgbToHex(c) });
    refresh();
  });

  refresh();

  return {
    setStatus: (text: string) => (statusEl.textContent = text),
  };
}
