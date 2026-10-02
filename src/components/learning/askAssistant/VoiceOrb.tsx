import { useEffect, useRef, type CSSProperties } from "react";
import "./voice-orb.css";

export type VoiceOrbMode = "idle" | "speaking" | "listening" | "thinking" | "error";

export interface VoiceOrbProps {
  mode: VoiceOrbMode;
  /** Read every animation frame; current audio level 0..1. A function (not a value) so the parent never re-renders per frame. May be undefined → treat as 0. */
  getLevel?: () => number;
  /** Diameter in CSS px, default 220. */
  size?: number;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

/* ------------------------------------------------------------------------ */
/* Palette + per-mode targets                                                */
/* ------------------------------------------------------------------------ */

type RGB = readonly [number, number, number];

const MINT: RGB = [124, 224, 195];
const TEAL: RGB = [45, 212, 191];
const SKY: RGB = [96, 165, 250];
const VIOLET: RGB = [167, 139, 250];
const GOLD: RGB = [245, 198, 106];
const ROSE: RGB = [251, 113, 133];

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** Pull a colour toward its own luminance grey (lower saturation). */
const desat = (c: RGB, t: number): RGB => {
  const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return mix(c, [l, l, l], t);
};

const BLOB_COUNT = 4;
// Colour slots: 4 blobs, core (base fill), glow (outer halo + rim + hot centre).
const SLOT_CORE = BLOB_COUNT;
const SLOT_GLOW = BLOB_COUNT + 1;
const COLOR_SLOTS = BLOB_COUNT + 2;

// Numeric params, lerped together so every mode change cross-fades.
const P_SPEED = 0; // morph speed (phase units / s)
const P_SWIRL = 1; // orbit angular velocity (rad / s)
const P_ORBIT = 2; // base blob distance from centre (× R)
const P_LEVEL_R = 3; // radius response to level
const P_LEVEL_D = 4; // blob displacement response to level
const P_BREATH = 5; // idle breathing amplitude
const P_GLOW = 6; // outer glow strength
const P_SHIMMER = 7; // thinking ring opacity
const P_RIPPLE = 8; // listening ripple weight
const P_BRIGHT = 9; // blob alpha multiplier
const P_LEVEL_USE = 10; // 0 = ignore level
const P_WOBBLE = 11; // edge wobble response to level
const PARAM_COUNT = 12;

interface ModeTarget {
  colors: RGB[]; // COLOR_SLOTS entries
  params: number[]; // PARAM_COUNT entries
}

const MODE_TARGETS: Record<VoiceOrbMode, ModeTarget> = {
  idle: {
    colors: [
      desat(TEAL, 0.35),
      desat(MINT, 0.35),
      desat(SKY, 0.4),
      desat(VIOLET, 0.45),
      [16, 62, 58],
      desat(TEAL, 0.25),
    ],
    //       speed swirl orbit lvlR lvlD breath glow shim ripple bright use wobble
    params: [0.32, 0.1, 0.3, 0.04, 0.2, 0.03, 0.42, 0, 0, 0.72, 1, 0.3],
  },
  speaking: {
    colors: [GOLD, MINT, mix(GOLD, [255, 236, 204], 0.35), mix(GOLD, MINT, 0.5), [30, 66, 54], GOLD],
    params: [0.55, 0.18, 0.3, 0.09, 0.6, 0.015, 0.6, 0, 0, 0.95, 1, 0.8],
  },
  listening: {
    colors: [SKY, VIOLET, MINT, mix(SKY, TEAL, 0.5), [24, 44, 96], mix(SKY, VIOLET, 0.3)],
    params: [0.62, -0.16, 0.3, 0.12, 0.85, 0.015, 0.62, 0, 1, 0.95, 1, 1],
  },
  thinking: {
    colors: [VIOLET, SKY, TEAL, MINT, [40, 32, 92], mix(VIOLET, SKY, 0.4)],
    params: [0.9, 2.1, 0.4, 0, 0, 0.02, 0.55, 1, 0, 0.9, 0, 0],
  },
  error: {
    // Settled state is a muted rose-mauve; the bright rose flush is `errorFlash`.
    colors: [
      desat(mix(ROSE, VIOLET, 0.2), 0.3),
      desat(VIOLET, 0.4),
      desat([196, 72, 112], 0.3),
      desat(mix(ROSE, GOLD, 0.35), 0.35),
      [56, 22, 36],
      desat(ROSE, 0.3),
    ],
    params: [0.3, 0.08, 0.28, 0.03, 0.2, 0.025, 0.42, 0, 0, 0.74, 1, 0.2],
  },
};

// Per-blob motion constants (fixed, so no per-frame allocation).
const BLOB_FA = [0.83, 1.07, 0.71, 0.97];
const BLOB_FB = [0.61, 0.89, 1.13, 0.77];
const BLOB_PA = [0.0, 1.7, 3.1, 4.6];
const BLOB_PB = [2.2, 0.4, 5.1, 3.6];
const BLOB_WOB = [0.37, 0.29, 0.43, 0.31];

const TAU = Math.PI * 2;
const ORB_RADIUS = 0.35; // orb body radius as a fraction of the element box
const RIPPLE_POOL = 6;
const RIPPLE_DURATION = 1.5; // s
const EDGE_POINTS = 48;

/* ------------------------------------------------------------------------ */
/* Renderer                                                                  */
/* ------------------------------------------------------------------------ */

interface Engine {
  setMode(mode: VoiceOrbMode): void;
  destroy(): void;
}

const rgba = (c: ArrayLike<number>, o: number, a: number) =>
  `rgba(${c[o] | 0},${c[o + 1] | 0},${c[o + 2] | 0},${a < 0 ? 0 : a > 1 ? 1 : a})`;

function createEngine(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  initialMode: VoiceOrbMode,
  readLevel: () => number,
): Engine {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return { setMode() {}, destroy() {} };
  const hasConic = typeof (ctx as CanvasRenderingContext2D).createConicGradient === "function";

  // ---- state -----------------------------------------------------------
  let mode = initialMode;
  const colors = new Float32Array(COLOR_SLOTS * 3);
  const shown = new Float32Array(COLOR_SLOTS * 3); // colors + transient error tint
  const params = new Float32Array(PARAM_COUNT);
  const snapToTarget = () => {
    const t = MODE_TARGETS[mode];
    for (let i = 0; i < COLOR_SLOTS; i++) {
      colors[i * 3] = t.colors[i][0];
      colors[i * 3 + 1] = t.colors[i][1];
      colors[i * 3 + 2] = t.colors[i][2];
    }
    for (let i = 0; i < PARAM_COUNT; i++) params[i] = t.params[i];
  };
  snapToTarget();

  let cssSize = 0;
  let dpr = 1;
  let phase = Math.random() * 100; // morph phase (speed-scaled)
  let swirl = Math.random() * TAU; // orbit angle
  let clock = 0; // real seconds
  let level = 0; // attack/release smoothed
  let levelSlow = 0; // slow average, used for peak detection
  let lastRipple = -10;
  let errorFlash = mode === "error" ? 1 : 0;
  const rippleAge = new Float32Array(RIPPLE_POOL).fill(RIPPLE_DURATION);
  const rippleStrength = new Float32Array(RIPPLE_POOL);
  let rippleNext = 0;

  let rafId = 0;
  let lastTs = 0;
  let destroyed = false;

  const reducedMq =
    typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduced = !!reducedMq?.matches;

  // ---- sizing ------------------------------------------------------------
  const resize = () => {
    // Layout size (ignores ancestor transforms such as dialog zoom-in animations).
    const next = Math.max(0, Math.min(root.clientWidth, root.clientHeight));
    const nextDpr = Math.min(2, window.devicePixelRatio || 1);
    if (next === cssSize && nextDpr === dpr) return false;
    cssSize = next;
    dpr = nextDpr;
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
    canvas.width = Math.max(1, Math.round(cssSize * dpr));
    canvas.height = Math.max(1, Math.round(cssSize * dpr));
    return true;
  };

  /** Brief rose flush on entering `error`, decaying into the settled palette. */
  const applyTint = () => {
    const t = errorFlash * errorFlash * 0.75;
    for (let i = 0; i < COLOR_SLOTS * 3; i += 3) {
      shown[i] = colors[i] + (ROSE[0] - colors[i]) * t;
      shown[i + 1] = colors[i + 1] + (ROSE[1] - colors[i + 1]) * t;
      shown[i + 2] = colors[i + 2] + (ROSE[2] - colors[i + 2]) * t;
    }
  };
  applyTint();

  // ---- simulation step -----------------------------------------------------
  const step = (dt: number) => {
    clock += dt;
    const target = MODE_TARGETS[mode];

    // Cross-fade colours/params: τ≈130 ms → ~95 % settled after ~400 ms.
    const k = 1 - Math.exp(-dt / 0.13);
    for (let i = 0; i < COLOR_SLOTS; i++) {
      const c = target.colors[i];
      const o = i * 3;
      colors[o] += (c[0] - colors[o]) * k;
      colors[o + 1] += (c[1] - colors[o + 1]) * k;
      colors[o + 2] += (c[2] - colors[o + 2]) * k;
    }
    for (let i = 0; i < PARAM_COUNT; i++) params[i] += (target.params[i] - params[i]) * k;

    // Level: fast attack (~60 ms), slow release (~250 ms).
    let raw = readLevel();
    if (!(raw > 0)) raw = 0; // also catches NaN / undefined
    else if (raw > 1) raw = 1;
    raw = Math.pow(raw, 0.8); // gentle perceptual lift for quiet voices
    const tau = raw > level ? 0.06 : 0.25;
    level += (raw - level) * (1 - Math.exp(-dt / tau));
    levelSlow += (level - levelSlow) * (1 - Math.exp(-dt / 0.6));

    phase += dt * params[P_SPEED] * (1 + level * params[P_LEVEL_USE] * 0.8);
    swirl += dt * params[P_SWIRL];
    if (errorFlash > 0) errorFlash = Math.max(0, errorFlash - dt / 1.4);
    applyTint();

    // Ripples on level peaks (listening).
    if (
      params[P_RIPPLE] > 0.5 &&
      level > 0.12 &&
      level - levelSlow > 0.07 &&
      clock - lastRipple > 0.34
    ) {
      lastRipple = clock;
      rippleAge[rippleNext] = 0;
      rippleStrength[rippleNext] = Math.min(1, 0.35 + (level - levelSlow) * 4);
      rippleNext = (rippleNext + 1) % RIPPLE_POOL;
    }
    for (let i = 0; i < RIPPLE_POOL; i++) {
      if (rippleAge[i] < RIPPLE_DURATION) rippleAge[i] += dt;
    }
  };

  // ---- drawing -------------------------------------------------------------
  const draw = () => {
    const w = cssSize;
    if (w <= 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, w);

    const c = w / 2;
    const use = params[P_LEVEL_USE];
    const lv = level * use;
    const flash = errorFlash * errorFlash; // ease-out
    const breath = Math.sin(clock * 1.15) * params[P_BREATH] + Math.sin(clock * 0.47 + 1.3) * params[P_BREATH] * 0.4;
    const R = w * ORB_RADIUS * (1 + breath + lv * params[P_LEVEL_R] - flash * 0.05);
    const glowO = SLOT_GLOW * 3;
    const coreO = SLOT_CORE * 3;

    // 1) Outer glow halo (fades to 0 exactly at the element edge — never clipped).
    const glowA = params[P_GLOW] * (1.05 + lv * 0.8 + flash * 0.6);
    let g = ctx.createRadialGradient(c, c, R * 0.9, c, c, c);
    g.addColorStop(0, rgba(shown, glowO, glowA * 0.7));
    g.addColorStop(0.12, rgba(shown, glowO, glowA * 0.36));
    g.addColorStop(0.35, rgba(shown, glowO, glowA * 0.13));
    g.addColorStop(0.65, rgba(shown, glowO, glowA * 0.035));
    g.addColorStop(1, rgba(shown, glowO, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);

    // 2) Ripple rings (behind the body so they appear to emanate from it).
    const rippleW = params[P_RIPPLE];
    if (rippleW > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      const maxR = c * 0.98;
      for (let i = 0; i < RIPPLE_POOL; i++) {
        const age = rippleAge[i];
        if (age >= RIPPLE_DURATION) continue;
        const p = age / RIPPLE_DURATION;
        const ease = 1 - (1 - p) * (1 - p) * (1 - p);
        const rr = R + (maxR - R) * ease;
        const fade = (1 - p) * (1 - p);
        const a = rippleStrength[i] * fade * rippleW;
        ctx.beginPath();
        ctx.arc(c, c, rr, 0, TAU);
        ctx.lineWidth = Math.max(1, w * 0.018 * (1 - p * 0.6));
        ctx.strokeStyle = rgba(shown, glowO, a * 0.16);
        ctx.stroke();
        ctx.lineWidth = Math.max(0.75, w * 0.005);
        ctx.strokeStyle = rgba(shown, glowO, a * 0.5);
        ctx.stroke();
      }
    }

    // 3) Orb body — organic circle, gently wobbling with level.
    ctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.beginPath();
    const wobble = R * (0.006 + lv * params[P_WOBBLE] * 0.035);
    for (let i = 0; i <= EDGE_POINTS; i++) {
      const a = (i / EDGE_POINTS) * TAU;
      const d =
        R +
        wobble *
          (Math.sin(a * 3 + phase * 2.1) * 0.6 +
            Math.sin(a * 5 - phase * 2.9 + 1.7) * 0.3 +
            Math.sin(a * 2 + phase * 1.3 + 0.6) * 0.5);
      const x = c + Math.cos(a) * d;
      const y = c + Math.sin(a) * d;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();

    // Base: deep tinted core, slightly lit from above.
    g = ctx.createRadialGradient(c, c - R * 0.2, 0, c, c, R);
    g.addColorStop(0, rgba(shown, coreO, 1));
    g.addColorStop(0.7, rgba(shown, coreO, 0.8));
    g.addColorStop(1, rgba(shown, coreO, 0.55));
    ctx.fillStyle = g;
    ctx.fillRect(c - R * 1.1, c - R * 1.1, R * 2.2, R * 2.2);

    // Blobs: layered like wet paint so colours stay rich (screen washes to white).
    ctx.globalCompositeOperation = "source-over";
    const orbit = params[P_ORBIT];
    const disp = params[P_LEVEL_D] * lv;
    const bright = params[P_BRIGHT] * (1 + flash * 0.25);
    for (let i = 0; i < BLOB_COUNT; i++) {
      const ang =
        swirl + (i * TAU) / BLOB_COUNT + 0.7 * Math.sin(phase * BLOB_WOB[i] + BLOB_PB[i]);
      const dist =
        R *
        (orbit +
          0.14 * Math.sin(phase * BLOB_FA[i] + BLOB_PA[i]) +
          disp * 0.28 * (0.55 + 0.45 * Math.sin(clock * 5.3 + i * 1.9)));
      const bx = c + Math.cos(ang) * dist;
      const by = c + Math.sin(ang) * dist * 0.92;
      const br = R * (0.8 + 0.16 * Math.sin(phase * BLOB_FB[i] + BLOB_PB[i]) + disp * 0.2);
      const o = i * 3;
      const a = bright * (0.78 + 0.22 * Math.sin(phase * 0.9 + i * 2.4));
      g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, rgba(shown, o, a));
      g.addColorStop(0.3, rgba(shown, o, a * 0.78));
      g.addColorStop(0.55, rgba(shown, o, a * 0.4));
      g.addColorStop(0.8, rgba(shown, o, a * 0.1));
      g.addColorStop(1, rgba(shown, o, 0));
      ctx.fillStyle = g;
      ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    }

    // Limb darkening — gives the body volume before the backlit rim.
    g = ctx.createRadialGradient(c - R * 0.1, c - R * 0.14, R * 0.45, c, c, R);
    g.addColorStop(0, "rgba(3,8,10,0)");
    g.addColorStop(0.7, "rgba(3,8,10,0.16)");
    g.addColorStop(1, "rgba(3,8,10,0.4)");
    ctx.fillStyle = g;
    ctx.fillRect(c - R * 1.1, c - R * 1.1, R * 2.2, R * 2.2);

    // Hot centre that swells with the voice (additive light from here on).
    ctx.globalCompositeOperation = "screen";
    const hotA = 0.14 + lv * 0.4 + (1 - use) * 0.1 + flash * 0.2;
    const hotR = R * (0.45 + lv * 0.25);
    const hx = c + Math.sin(phase * 0.7) * R * 0.06;
    const hy = c + Math.cos(phase * 0.55) * R * 0.06;
    g = ctx.createRadialGradient(hx, hy, 0, hx, hy, hotR);
    g.addColorStop(0, `rgba(255,255,255,${Math.min(1, hotA * 0.9)})`);
    g.addColorStop(0.35, rgba(shown, glowO, hotA * 0.6));
    g.addColorStop(1, rgba(shown, glowO, 0));
    ctx.fillStyle = g;
    ctx.fillRect(hx - hotR, hy - hotR, hotR * 2, hotR * 2);

    // Fresnel rim — light wrapping the edge gives it volume.
    g = ctx.createRadialGradient(c, c, R * 0.78, c, c, R);
    g.addColorStop(0, rgba(shown, glowO, 0));
    g.addColorStop(0.55, rgba(shown, glowO, 0.05 + lv * 0.06));
    g.addColorStop(0.88, rgba(shown, glowO, 0.26 + lv * 0.14));
    g.addColorStop(1, rgba(shown, glowO, 0.55 + lv * 0.2));
    ctx.fillStyle = g;
    ctx.fillRect(c - R * 1.1, c - R * 1.1, R * 2.2, R * 2.2);

    // Glossy highlight, upper-left.
    const sx = c - R * 0.34;
    const sy = c - R * 0.46;
    g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.72);
    g.addColorStop(0, "rgba(255,255,255,0.26)");
    g.addColorStop(0.4, "rgba(255,255,255,0.08)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(sx - R * 0.72, sy - R * 0.72, R * 1.44, R * 1.44);
    ctx.restore();

    // 4) Thinking: thin rotating conic shimmer ring.
    const shimmer = params[P_SHIMMER];
    if (shimmer > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      const rr = R * 1.1;
      const lw = Math.max(1, w * 0.007);
      // faint full track
      ctx.beginPath();
      ctx.arc(c, c, rr, 0, TAU);
      ctx.lineWidth = lw;
      ctx.strokeStyle = rgba(shown, glowO, 0.1 * shimmer);
      ctx.stroke();
      const rot = clock * 2.6;
      if (hasConic) {
        const cg = ctx.createConicGradient(rot, c, c);
        cg.addColorStop(0, rgba(shown, glowO, 0));
        cg.addColorStop(0.55, rgba(shown, glowO, 0));
        cg.addColorStop(0.9, rgba(shown, glowO, 0.55 * shimmer));
        cg.addColorStop(0.985, `rgba(255,255,255,${0.95 * shimmer})`);
        cg.addColorStop(1, rgba(shown, glowO, 0));
        ctx.beginPath();
        ctx.arc(c, c, rr, 0, TAU);
        ctx.lineWidth = lw * 1.3;
        ctx.strokeStyle = cg;
        ctx.stroke();
      } else {
        // Fallback: comet tail from short arc segments.
        const segs = 14;
        const span = 2.4;
        ctx.lineWidth = lw * 1.3;
        ctx.lineCap = "round";
        for (let i = 0; i < segs; i++) {
          const t = (i + 1) / segs;
          const a0 = rot + span * (i / segs);
          ctx.beginPath();
          ctx.arc(c, c, rr, a0, a0 + span / segs);
          ctx.strokeStyle = rgba(shown, glowO, t * t * 0.8 * shimmer);
          ctx.stroke();
        }
        ctx.lineCap = "butt";
      }
    }
    ctx.globalCompositeOperation = "source-over";
  };

  // ---- loop ------------------------------------------------------------------
  const frame = (ts: number) => {
    rafId = 0;
    if (destroyed) return;
    const dt = lastTs ? Math.min(0.05, Math.max(0, (ts - lastTs) / 1000)) : 1 / 60;
    lastTs = ts;
    if (Math.min(2, window.devicePixelRatio || 1) !== dpr) resize();
    step(dt);
    draw();
    rafId = requestAnimationFrame(frame);
  };

  const start = () => {
    if (rafId || destroyed || reduced || document.hidden) return;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  };
  const stop = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  /** Reduced motion: one static, settled frame. */
  const drawStatic = () => {
    snapToTarget();
    level = 0;
    errorFlash = 0;
    phase = 3.1;
    swirl = 0.6;
    clock = 0;
    rippleAge.fill(RIPPLE_DURATION);
    applyTint();
    draw();
  };

  const syncMotionPref = () => {
    reduced = !!reducedMq?.matches;
    if (reduced) {
      stop();
      drawStatic();
    } else {
      start();
    }
  };

  const onVisibility = () => {
    if (document.hidden) stop();
    else start();
  };

  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (resize() && (reduced || !rafId)) {
            if (reduced) drawStatic();
            else draw();
          }
        })
      : null;
  ro?.observe(root);
  resize();
  document.addEventListener("visibilitychange", onVisibility);
  reducedMq?.addEventListener?.("change", syncMotionPref);
  syncMotionPref();

  return {
    setMode(next) {
      if (next === mode) return;
      mode = next;
      if (next === "error") errorFlash = 1;
      if (reduced) drawStatic();
    },
    destroy() {
      destroyed = true;
      stop();
      ro?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reducedMq?.removeEventListener?.("change", syncMotionPref);
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Component                                                                 */
/* ------------------------------------------------------------------------ */

export function VoiceOrb({
  mode,
  getLevel,
  size = 220,
  onClick,
  ariaLabel,
  className,
}: VoiceOrbProps): JSX.Element {
  const rootRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const getLevelRef = useRef(getLevel);
  getLevelRef.current = getLevel;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const isButton = !!onClick;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const engine = createEngine(root, canvas, modeRef.current, () => {
      const fn = getLevelRef.current;
      return fn ? fn() : 0;
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // Re-bind if the root element swaps between <button> and <div>.
  }, [isButton]);

  useEffect(() => {
    engineRef.current?.setMode(mode);
  }, [mode]);

  const classes = ["vo-root", isButton ? "vo-button" : "", className ?? ""].filter(Boolean).join(" ");
  const style = { "--vo-size": `${size}px` } as CSSProperties;
  const canvas = <canvas ref={canvasRef} className="vo-canvas" aria-hidden="true" />;

  if (isButton) {
    return (
      <button
        type="button"
        ref={(el) => (rootRef.current = el)}
        className={classes}
        style={style}
        onClick={onClick}
        aria-label={ariaLabel}
        data-mode={mode}
      >
        {canvas}
      </button>
    );
  }
  return (
    <div
      ref={(el) => (rootRef.current = el)}
      role="img"
      className={classes}
      style={style}
      aria-label={ariaLabel}
      data-mode={mode}
    >
      {canvas}
    </div>
  );
}

export default VoiceOrb;
