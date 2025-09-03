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
const MAX_DEG_PER_S: Record<UBKey, number> = {
  chest: 120,
  l_shoulder: 180,
  r_shoulder: 180,
  l_upper_arm: 240,
  r_upper_arm: 240,
  l_lower_arm: 240,
  r_lower_arm: 240,
  l_wrist: 360,
  r_wrist: 360,
};

export function OscBridge() {
  const lastSentRef = useRef(0);
  const latestRef = useRef<Pose | null>(null);
  const upperRef = useRef<UpperBody | null>(null); // latest measured local quats
  const upper3dRef = useRef<UpperBody3D | null>(null); // latest 3D joints with visibility
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
        // Stabilize per-bone
        const u3 = upper3dRef.current;
        const nowMs = now;
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
          const maxStep = (MAX_DEG_PER_S[k] || 180) * DEG2RAD * dt;

          // Phase transitions
          const isVisible = vis >= VIS_LOST && measured != null;
          if (isVisible) {
            bs.lastSeen = nowMs;
            bs.lastMeasured = measured!;
            if (bs.phase === "hold" || bs.phase === "fade") {
              bs.phase = "reacq";
              bs.reacqStart = nowMs;
            } else if (bs.phase !== "normal") {
              bs.phase = "normal";
            }
          } else {
            // missing
            if (bs.phase === "normal" || bs.phase === "reacq") {
              bs.phase = "hold";
            }
            // escalate to fade after hold duration
            if (nowMs - bs.lastSeen > HOLD_MS) {
              if (bs.phase !== "fade") {
                bs.phase = "fade";
                bs.fadeStart = nowMs;
              }
            }
          }

          // Output by phase
          let targetOut: Quat;
          if (bs.phase === "normal") {
            targetOut = measured ?? prevOut;
          } else if (bs.phase === "reacq") {
            const t = Math.min(1, Math.max(0, (nowMs - (bs.reacqStart ?? nowMs)) / REACQ_MS));
            targetOut = slerp(prevOut, measured ?? prevOut, t);
          } else if (bs.phase === "hold") {
            targetOut = prevOut; // keep last
          } else {
            // fade
            const t = Math.min(1, Math.max(0, (nowMs - (bs.fadeStart ?? nowMs)) / FADE_MS));
            targetOut = slerp(prevOut, IDENTITY, t);
          }

          // Angular velocity clamp (except pure hold)
          const out = bs.phase === "hold" ? targetOut : stepToward(prevOut, targetOut, maxStep);
          bs.lastOut = out;
          bs.lastUpdate = nowMs;
          (stabilized as Record<string, Quat | undefined>)[k] = out;
        }

        invoke("osc_update_upper", { upper: stabilized }).catch(() => {});
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
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return null;
}

export default OscBridge;
