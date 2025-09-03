import { useEffect, useRef } from "react";
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

export function OscBridge() {
  const lastSentRef = useRef(0);
  const latestRef = useRef<Pose | null>(null);
  const upperRef = useRef<UpperBody | null>(null);
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
        invoke("osc_update_upper", { upper }).catch(() => {});
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
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return null;
}

export default OscBridge;
