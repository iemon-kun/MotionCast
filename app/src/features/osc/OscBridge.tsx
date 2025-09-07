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
  nose?: UB3DPoint;
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
  // 表情ソース: raw | vrm
  const exprSourceRef = useRef<"raw" | "vrm">("raw");
  const vrmExprRef = useRef<{
    blink?: number;
    mouth?: number;
    ts?: number;
  } | null>(null);
  // Lightweight metrics (enabled via UI toggle)
  const metricsEnabledRef = useRef<boolean>(false);
  const tickCountRef = useRef<number>(0);
  const lastMetricsRef = useRef<number>(0);
  const latAccRef = useRef<{ sum: number; count: number }>({
    sum: 0,
    count: 0,
  });
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
  // Calibration (basis/scale)
  const calibRef = useRef<
    | null
    | {
        origin: { x: number; y: number; z: number };
        x: { x: number; y: number; z: number };
        y: { x: number; y: number; z: number };
        z: { x: number; y: number; z: number };
        scale: number;
      }
  >(null);
  const shoulderTargetRef = useRef<number>(0.38);

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
    // Calibration triggers and params
    const onCalib = () => {
      try {
        const u3 = upper3dRef.current;
        if (!u3 || !u3.lShoulder || !u3.rShoulder || !(u3.lHip || u3.rHip))
          return;
        const pLs = u3.lShoulder;
        const pRs = u3.rShoulder;
        const pLc = u3.lHip ?? u3.rHip!;
        const pRc = u3.rHip ?? u3.lHip!;
        const origin = {
          x: (pLc.x + pRc.x) / 2,
          y: (pLc.y + pRc.y) / 2,
          z: (pLc.z + pRc.z) / 2,
        };
        const vx = { x: pRs.x - pLs.x, y: pRs.y - pLs.y, z: pRs.z - pLs.z };
        const vym = {
          x: (pLs.x + pRs.x) * 0.5 - origin.x,
          y: (pLs.y + pRs.y) * 0.5 - origin.y,
          z: (pLs.z + pRs.z) * 0.5 - origin.z,
        };
        const norm = (v: { x: number; y: number; z: number }) => {
          const l = Math.hypot(v.x, v.y, v.z) || 1;
          return { x: v.x / l, y: v.y / l, z: v.z / l };
        };
        const cross = (
          a: { x: number; y: number; z: number },
          b: { x: number; y: number; z: number },
        ) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
        const x = norm(vx);
        let y = norm(vym);
        let z = norm(cross(x, y));
        y = norm(cross(z, x));
        const measuredShoulder = Math.hypot(vx.x, vx.y, vx.z) || 1;
        const target = Math.max(0.2, Math.min(0.8, shoulderTargetRef.current));
        const scale = target / measuredShoulder;
        calibRef.current = { origin, x, y, z, scale };
      } catch {
        /* noop */
      }
    };
    const onCalibParams = (ev: Event) => {
      const ce = ev as CustomEvent<{ shoulderWidthM?: number }>;
      const sw = ce.detail?.shoulderWidthM;
      if (typeof sw === "number" && Number.isFinite(sw) && sw > 0)
        shoulderTargetRef.current = Math.max(0.2, Math.min(0.8, sw));
    };
    window.addEventListener("motioncast:calibrate", onCalib);
    window.addEventListener(
      "motioncast:tracker-calib-params",
      onCalibParams as EventListener,
    );

    // 表情ソース切替とVRM表情値
    const onExprSrc = (ev: Event) => {
      const ce = ev as CustomEvent<unknown>;
      const v = ce?.detail as unknown as string;
      exprSourceRef.current = v === "vrm" ? "vrm" : "raw";
    };
    const onVrmExpr = (ev: Event) => {
      const ce = ev as CustomEvent<{
        blink?: number;
        mouth?: number;
        ts?: number;
      }>;
      vrmExprRef.current = ce.detail || null;
    };
    window.addEventListener(
      "motioncast:expr-source",
      onExprSrc as EventListener,
    );
    window.addEventListener(
      "motioncast:vrm-expression",
      onVrmExpr as EventListener,
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
        const src = exprSourceRef.current;
        const blink =
          src === "vrm"
            ? (vrmExprRef.current?.blink ?? pose.blink ?? 0)
            : (pose.blink ?? 0);
        const mouth =
          src === "vrm"
            ? (vrmExprRef.current?.mouth ?? pose.mouth ?? 0)
            : (pose.mouth ?? 0);
        const payload = {
          yaw: pose.yaw ?? 0,
          pitch: pose.pitch ?? 0,
          roll: pose.roll ?? 0,
          blink,
          mouth,
        };
        invoke("osc_update", { pose: payload }).catch(() => {});
      }
      const upper = upperRef.current;
      if (upper) {
        const cfg = cfgRef.current;
        if (!cfg.enabled) {
          invoke("osc_update_upper", { upper }).catch(() => {});
          // 位置（トラッカー）も可能なら送る
          const u3 = upper3dRef.current;
          if (u3) {
            const visOk = (p?: UB3DPoint) =>
              !!p && (typeof p.v !== "number" || p.v >= cfg.visLost);
            const chest =
              visOk(u3.lShoulder) && visOk(u3.rShoulder)
                ? {
                    x: (u3.lShoulder!.x + u3.rShoulder!.x) / 2,
                    y: (u3.lShoulder!.y + u3.rShoulder!.y) / 2,
                    z: (u3.lShoulder!.z + u3.rShoulder!.z) / 2,
                  }
                : undefined;
            const hips =
              visOk(u3.lHip) && visOk(u3.rHip)
                ? {
                    x: (u3.lHip!.x + u3.rHip!.x) / 2,
                    y: (u3.lHip!.y + u3.rHip!.y) / 2,
                    z: (u3.lHip!.z + u3.rHip!.z) / 2,
                  }
                : undefined;
            const head = visOk(u3.nose)
              ? { x: u3.nose!.x, y: u3.nose!.y, z: u3.nose!.z }
              : undefined;
            const l_wrist = visOk(u3.lWrist)
              ? {
                  x: u3.lWrist!.x,
                  y: u3.lWrist!.y,
                  z: u3.lWrist!.z,
                }
              : undefined;
            const r_wrist = visOk(u3.rWrist)
              ? {
                  x: u3.rWrist!.x,
                  y: u3.rWrist!.y,
                  z: u3.rWrist!.z,
                }
              : undefined;
            const applyCalib = (
              v?: { x: number; y: number; z: number },
            ): { x: number; y: number; z: number } | undefined => {
              const C = calibRef.current;
              if (!v || !C) return v;
              const rel = { x: v.x - C.origin.x, y: v.y - C.origin.y, z: v.z - C.origin.z };
              const dot = (
                a: { x: number; y: number; z: number },
                b: { x: number; y: number; z: number },
              ) => a.x * b.x + a.y * b.y + a.z * b.z;
              const ax = dot(rel, C.x);
              const ay = dot(rel, C.y);
              const az = dot(rel, C.z);
              return { x: ax * C.scale, y: ay * C.scale, z: az * C.scale };
            };
            const tHead = applyCalib(head);
            const tChest = applyCalib(chest);
            const tHips = applyCalib(hips);
            const tLWrist = applyCalib(l_wrist);
            const tRWrist = applyCalib(r_wrist);
            const yaw = (yawDegRef.current * Math.PI) / 180;
            const s = Math.sin(yaw);
            const c = Math.cos(yaw);
            const off = offsetRef.current;
            const rotT = (
              v?: { x: number; y: number; z: number },
            ): { x: number; y: number; z: number } | undefined => {
              if (!v) return v;
              const xr = v.x * c + v.z * s;
              const zr = -v.x * s + v.z * c;
              return { x: xr + off.x, y: v.y + off.y, z: zr + off.z };
            };
            const rHead = rotT(tHead);
            const rChest = rotT(tChest);
            const rHips = rotT(tHips);
            const rLWrist = rotT(tLWrist);
            const rRWrist = rotT(tRWrist);
            invoke("osc_update_trackers", {
              trackers: {
                head: rHead ?? tHead ?? head,
                chest: rChest ?? tChest ?? chest,
                hips: rHips ?? tHips ?? hips,
                l_wrist: rLWrist ?? tLWrist ?? l_wrist,
                r_wrist: rRWrist ?? tRWrist ?? r_wrist,
              },
            }).catch(() => {});
          }
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
        // 位置（トラッカー）: 上半身3Dから胸/腰/両手首/頭（鼻）を抽出
        if (u3) {
          const visOk = (p?: UB3DPoint) =>
            !!p && (typeof p.v !== "number" || p.v >= cfg.visLost);
          const chest =
            visOk(u3.lShoulder) && visOk(u3.rShoulder)
              ? {
                  x: (u3.lShoulder!.x + u3.rShoulder!.x) / 2,
                  y: (u3.lShoulder!.y + u3.rShoulder!.y) / 2,
                  z: (u3.lShoulder!.z + u3.rShoulder!.z) / 2,
                }
              : undefined;
          const hips =
            visOk(u3.lHip) && visOk(u3.rHip)
              ? {
                  x: (u3.lHip!.x + u3.rHip!.x) / 2,
                  y: (u3.lHip!.y + u3.rHip!.y) / 2,
                  z: (u3.lHip!.z + u3.rHip!.z) / 2,
                }
              : undefined;
          const head = visOk(u3.nose)
            ? { x: u3.nose!.x, y: u3.nose!.y, z: u3.nose!.z }
            : undefined;
          const l_wrist = visOk(u3.lWrist)
            ? { x: u3.lWrist!.x, y: u3.lWrist!.y, z: u3.lWrist!.z }
            : undefined;
          const r_wrist = visOk(u3.rWrist)
            ? { x: u3.rWrist!.x, y: u3.rWrist!.y, z: u3.rWrist!.z }
            : undefined;
            const applyCalib = (
              v?: { x: number; y: number; z: number },
            ): { x: number; y: number; z: number } | undefined => {
              const C = calibRef.current;
              if (!v || !C) return v;
              const rel = { x: v.x - C.origin.x, y: v.y - C.origin.y, z: v.z - C.origin.z };
              const dot = (
                a: { x: number; y: number; z: number },
                b: { x: number; y: number; z: number },
              ) => a.x * b.x + a.y * b.y + a.z * b.z;
              const ax = dot(rel, C.x);
              const ay = dot(rel, C.y);
              const az = dot(rel, C.z);
              return { x: ax * C.scale, y: ay * C.scale, z: az * C.scale };
            };
            const tHead = applyCalib(head);
            const tChest = applyCalib(chest);
            const tHips = applyCalib(hips);
            const tLWrist = applyCalib(l_wrist);
            const tRWrist = applyCalib(r_wrist);
            invoke("osc_update_trackers", {
              trackers: {
                head: tHead ?? head,
                chest: tChest ?? chest,
                hips: tHips ?? hips,
                l_wrist: tLWrist ?? l_wrist,
                r_wrist: tRWrist ?? r_wrist,
              },
            }).catch(() => {});
          }
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
      window.removeEventListener("motioncast:calibrate", onCalib);
      window.removeEventListener(
        "motioncast:tracker-calib-params",
        onCalibParams as EventListener,
      );
      window.removeEventListener(
        "motioncast:expr-source",
        onExprSrc as EventListener,
      );
      window.removeEventListener(
        "motioncast:vrm-expression",
        onVrmExpr as EventListener,
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
