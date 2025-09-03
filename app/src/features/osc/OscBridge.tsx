import { useEffect, useRef } from "react";
import { Quaternion as TQuat } from "three";
import { invoke } from "@tauri-apps/api/core";

type Pose = {
  yaw?: number;
  pitch?: number;
  roll?: number;
  blink?: number;
  mouth?: number;
  ts?: number;
};

type Quat = { x: number; y: number; z: number; w: number };
type UpperBody = {
  chest?: Quat;
  l_shoulder?: Quat;
  r_shoulder?: Quat;
  l_upper_arm?: Quat;
  r_upper_arm?: Quat;
  l_lower_arm?: Quat;
  r_lower_arm?: Quat;
  l_wrist?: Quat;
  r_wrist?: Quat;
};

type UBKey =
  | "chest"
  | "l_shoulder"
  | "r_shoulder"
  | "l_upper_arm"
  | "r_upper_arm"
  | "l_lower_arm"
  | "r_lower_arm"
  | "l_wrist"
  | "r_wrist";

type UB3DPoint = { x: number; y: number; z: number; v?: number };
type UpperBody3D = {
  lShoulder?: UB3DPoint;
  rShoulder?: UB3DPoint;
  lElbow?: UB3DPoint;
  rElbow?: UB3DPoint;
  lWrist?: UB3DPoint;
  rWrist?: UB3DPoint;
  lHip?: UB3DPoint;
  rHip?: UB3DPoint;
  ts: number;
};

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

function tq(q: Quat): TQuat {
  return new TQuat(q.x, q.y, q.z, q.w).normalize();
}
function fromT(q: TQuat): Quat {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}
function slerp(a: Quat, b: Quat, t: number): Quat {
  const qa = tq(a);
  const qb = tq(b);
  qa.slerp(qb, Math.max(0, Math.min(1, t)));
  return fromT(qa);
}
function angularDistance(a: Quat, b: Quat): number {
  const qa = tq(a);
  const qb = tq(b);
  const dot = Math.max(-1, Math.min(1, qa.dot(qb)));
  return Math.acos(Math.abs(dot)) * 2; // shortest-arc angle
}
function stepToward(prev: Quat, target: Quat, maxRad: number): Quat {
  const ang = angularDistance(prev, target);
  if (!isFinite(ang) || ang <= 1e-6) return target;
  if (ang <= maxRad) return target;
  const t = Math.max(0, Math.min(1, maxRad / ang));
  return slerp(prev, target, t);
}

// ---- Stabilizer helpers ----
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
function clampMs(x: number): number {
  const v = Number.isFinite(x) ? x : 0;
  return Math.max(0, Math.min(5000, Math.round(v)));
}
function clampDeg(x: number): number {
  const v = Number.isFinite(x) ? x : 0;
  return Math.max(0, Math.min(1000, v));
}

type Phase = "normal" | "hold" | "fade" | "reacq";
type BoneState = {
  phase: Phase;
  lastSeen: number; // ms
  lastOut: Quat; // last output we sent
  lastMeasured?: Quat; // latest measurement
  fadeStart?: number; // ms
  reacqStart?: number; // ms
  lastUpdate?: number; // ms (for velocity clamp)
};

// Parameters (will be exposed via UI later)
const VIS_LOST = 0.3; // below -> missing
const HOLD_MS = 400;
const FADE_MS = 800;
const REACQ_MS = 300;

const DEG2RAD = Math.PI / 180;

export function OscBridge() {
  const lastSentRef = useRef(0);
  const latestRef = useRef<Pose | null>(null);
  const upperRef = useRef<UpperBody | null>(null); // latest measured local quats
  const upper3dRef = useRef<UpperBody3D | null>(null); // latest 3D joints with visibility
  // Lightweight metrics (enabled via UI toggle)
  const metricsEnabledRef = useRef<boolean>(false);
  const tickCountRef = useRef<number>(0);
  const lastMetricsRef = useRef<number>(0);
  const latAccRef = useRef<{ sum: number; count: number }>({ sum: 0, count: 0 });
  const statCounterRef = useRef<{ hold: number; fade: number; reacq: number }>({
    hold: 0,
    fade: 0,
    reacq: 0,
  });
  const cfgRef = useRef({
    enabled: true,
    visLost: VIS_LOST,
    holdMs: HOLD_MS,
    fadeMs: FADE_MS,
    reacqMs: REACQ_MS,
    chestMax: 120,
    shoulderMax: 180,
    upperLowerMax: 240,
    wristMax: 360,
  });
  const stateRef = useRef<Record<UBKey, BoneState>>({
    chest: { phase: "hold", lastSeen: 0, lastOut: IDENTITY },
    l_shoulder: { phase: "hold", lastSeen: 0, lastOut: IDENTITY },
    r_shoulder: { phase: "hold", lastSeen: 0, lastOut: IDENTITY },
    l_upper_arm: { phase: "hold", lastSeen: 0, lastOut: IDENTITY },
    r_upper_arm: { phase: "hold", lastSeen: 0, lastOut: IDENTITY },
    l_lower_arm: { phase: "hold", lastSeen: 0, lastOut: IDENTITY },
    r_lower_arm: { phase: "hold", lastSeen: 0, lastOut: IDENTITY },
    l_wrist: { phase: "hold", lastSeen: 0, lastOut: IDENTITY },
    r_wrist: { phase: "hold", lastSeen: 0, lastOut: IDENTITY },
  });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const onPose = (ev: Event) => {
      const ce = ev as CustomEvent<Pose>;
      latestRef.current = ce.detail;
    };
    window.addEventListener("motioncast:pose-update", onPose as EventListener);
    const onUpper = (ev: Event) => {
      const ce = ev as CustomEvent<UpperBody>;
      upperRef.current = ce.detail;
    };
    window.addEventListener(
      "motioncast:upper-body-quat",
      onUpper as EventListener,
    );
    const onUpper3d = (ev: Event) => {
      const ce = ev as CustomEvent<UpperBody3D>;
      upper3dRef.current = ce.detail;
    };
    window.addEventListener(
      "motioncast:upper-body-3d",
      onUpper3d as EventListener,
    );

    const onCfg = (ev: Event) => {
      const ce = ev as CustomEvent<Partial<typeof cfgRef.current>>;
      const cur = cfgRef.current;
      cfgRef.current = {
        enabled: ce.detail?.enabled ?? cur.enabled,
        visLost: clamp01(ce.detail?.visLost ?? cur.visLost),
        holdMs: clampMs(ce.detail?.holdMs ?? cur.holdMs),
        fadeMs: clampMs(ce.detail?.fadeMs ?? cur.fadeMs),
        reacqMs: clampMs(ce.detail?.reacqMs ?? cur.reacqMs),
        chestMax: clampDeg(ce.detail?.chestMax ?? cur.chestMax),
        shoulderMax: clampDeg(ce.detail?.shoulderMax ?? cur.shoulderMax),
        upperLowerMax: clampDeg(ce.detail?.upperLowerMax ?? cur.upperLowerMax),
        wristMax: clampDeg(ce.detail?.wristMax ?? cur.wristMax),
      };
    };
    window.addEventListener(
      "motioncast:stabilizer-params",
      onCfg as EventListener,
    );
    // Metrics on/off (from UI)
    const onMetrics = (ev: Event) => {
      const ce = ev as CustomEvent<boolean | { enabled: boolean }>;
      const d: unknown = ce.detail;
      metricsEnabledRef.current =
        typeof d === "object"
          ? Boolean((d as { enabled?: unknown }).enabled)
          : Boolean(d);
      if (metricsEnabledRef.current) {
        tickCountRef.current = 0;
        lastMetricsRef.current = performance.now();
        latAccRef.current = { sum: 0, count: 0 };
      }
    };
    window.addEventListener(
      "motioncast:metrics-enabled",
      onMetrics as EventListener,
    );

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const now = performance.now();
      if (now - lastSentRef.current < 33) return; // ~30Hz
      lastSentRef.current = now;
      const pose = latestRef.current;
      if (pose) {
        // send best-effort; ignore errors when not on tauri context
        const payload = {
          yaw: pose.yaw ?? 0,
          pitch: pose.pitch ?? 0,
          roll: pose.roll ?? 0,
          blink: pose.blink ?? 0,
          mouth: pose.mouth ?? 0,
        };
        invoke("osc_update", { pose: payload }).catch(() => {});
      }
      const upper = upperRef.current;
      if (upper) {
        const cfg = cfgRef.current;
        if (!cfg.enabled) {
          invoke("osc_update_upper", { upper }).catch(() => {});
          return;
        }
        // Stabilize per-bone
        const u3 = upper3dRef.current;
        const nowMs = now;
        const maxMap = (k: UBKey): number => {
          switch (k) {
            case "chest":
              return cfg.chestMax;
            case "l_shoulder":
            case "r_shoulder":
              return cfg.shoulderMax;
            case "l_upper_arm":
            case "r_upper_arm":
            case "l_lower_arm":
            case "r_lower_arm":
              return cfg.upperLowerMax;
            case "l_wrist":
            case "r_wrist":
              return cfg.wristMax;
            default:
              return 180;
          }
        };
        const makeVis = (key: UBKey): number => {
          // derive bone visibility from 3D joints
          const avg = (...xs: Array<number | undefined>) => {
            const ys = xs.filter((v): v is number => typeof v === "number");
            if (!ys.length) return 0;
            return ys.reduce((a, b) => a + b, 0) / ys.length;
          };
          if (!u3) return 1; // if unknown, assume visible
          switch (key) {
            case "chest":
              return avg(u3.lShoulder?.v, u3.rShoulder?.v) || 1;
            case "l_shoulder":
              return u3.lShoulder?.v ?? 0;
            case "r_shoulder":
              return u3.rShoulder?.v ?? 0;
            case "l_upper_arm":
              return avg(u3.lShoulder?.v, u3.lElbow?.v);
            case "r_upper_arm":
              return avg(u3.rShoulder?.v, u3.rElbow?.v);
            case "l_lower_arm":
              return avg(u3.lElbow?.v, u3.lWrist?.v);
            case "r_lower_arm":
              return avg(u3.rElbow?.v, u3.rWrist?.v);
            case "l_wrist":
              return u3.lWrist?.v ?? 0;
            case "r_wrist":
              return u3.rWrist?.v ?? 0;
            default:
              return 1;
          }
        };

        const keys: UBKey[] = [
          "chest",
          "l_shoulder",
          "r_shoulder",
          "l_upper_arm",
          "r_upper_arm",
          "l_lower_arm",
          "r_lower_arm",
          "l_wrist",
          "r_wrist",
        ];

        const stabilized: UpperBody = {};
        const st = stateRef.current;
        for (const k of keys) {
          const vis = makeVis(k);
          const measured = (upper as Record<string, Quat | undefined>)[k];
          const bs = st[k];
          const prevOut = bs.lastOut;
          const prevUpdate = bs.lastUpdate ?? nowMs;
          const dt = Math.max(0, (nowMs - prevUpdate) / 1000);
          const maxStep = (maxMap(k) || 180) * DEG2RAD * dt;

          // Phase transitions
          const isVisible = vis >= cfg.visLost && measured != null;
          if (isVisible) {
            bs.lastSeen = nowMs;
            bs.lastMeasured = measured!;
            if (bs.phase === "hold" || bs.phase === "fade") {
              bs.phase = "reacq";
              statCounterRef.current.reacq++;
              bs.reacqStart = nowMs;
            } else if (bs.phase !== "normal") {
              bs.phase = "normal";
            }
          } else {
            // missing
            if (bs.phase === "normal" || bs.phase === "reacq") {
              bs.phase = "hold";
              statCounterRef.current.hold++;
            }
            // escalate to fade after hold duration
            if (nowMs - bs.lastSeen > cfg.holdMs) {
              if (bs.phase !== "fade") {
                bs.phase = "fade";
                statCounterRef.current.fade++;
                bs.fadeStart = nowMs;
              }
            }
          }

          // Output by phase
          let targetOut: Quat;
          if (bs.phase === "normal") {
            targetOut = measured ?? prevOut;
          } else if (bs.phase === "reacq") {
            const t = Math.min(
              1,
              Math.max(0, (nowMs - (bs.reacqStart ?? nowMs)) / cfg.reacqMs),
            );
            targetOut = slerp(prevOut, measured ?? prevOut, t);
          } else if (bs.phase === "hold") {
            targetOut = prevOut; // keep last
          } else {
            // fade
            const t = Math.min(
              1,
              Math.max(0, (nowMs - (bs.fadeStart ?? nowMs)) / cfg.fadeMs),
            );
            targetOut = slerp(prevOut, IDENTITY, t);
          }

          // Angular velocity clamp (except pure hold)
          const out =
            bs.phase === "hold"
              ? targetOut
              : stepToward(prevOut, targetOut, maxStep);
          bs.lastOut = out;
          bs.lastUpdate = nowMs;
          (stabilized as Record<string, Quat | undefined>)[k] = out;
        }

        invoke("osc_update_upper", { upper: stabilized }).catch(() => {});
      }
      // Metrics accumulation & publish (1Hz)
      if (metricsEnabledRef.current) {
        tickCountRef.current += 1;
        if (pose && typeof pose.ts === "number") {
          const lat = Math.max(0, now - pose.ts);
          if (Number.isFinite(lat)) {
            latAccRef.current.sum += lat;
            latAccRef.current.count += 1;
          }
        }
        const lastTs = lastMetricsRef.current || now;
        if (now - lastTs >= 1000) {
          const hz = tickCountRef.current;
          const { sum, count } = latAccRef.current;
          const meanLatencyMs = count > 0 ? sum / count : 0;
          try {
            window.dispatchEvent(
              new CustomEvent("motioncast:bridge-metrics", {
                detail: { hz, meanLatencyMs },
              }),
            );
            window.dispatchEvent(
              new CustomEvent("motioncast:stabilizer-metrics", {
                detail: {
                  hold: statCounterRef.current.hold,
                  fade: statCounterRef.current.fade,
                  reacq: statCounterRef.current.reacq,
                },
              }),
            );
          } catch {
            /* noop */
          }
          tickCountRef.current = 0;
          latAccRef.current = { sum: 0, count: 0 };
          lastMetricsRef.current = now;
        }
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener(
        "motioncast:pose-update",
        onPose as EventListener,
      );
      window.removeEventListener(
        "motioncast:upper-body-quat",
        onUpper as EventListener,
      );
      window.removeEventListener(
        "motioncast:upper-body-3d",
        onUpper3d as EventListener,
      );
      window.removeEventListener(
        "motioncast:stabilizer-params",
        onCfg as EventListener,
      );
      window.removeEventListener(
        "motioncast:metrics-enabled",
        onMetrics as EventListener,
      );
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return null;
}

export default OscBridge;
