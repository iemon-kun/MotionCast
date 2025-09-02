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

export function OscBridge() {
  const lastSentRef = useRef(0);
  const latestRef = useRef<Pose | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const onPose = (ev: Event) => {
      const ce = ev as CustomEvent<Pose>;
      latestRef.current = ce.detail;
    };
    window.addEventListener("motioncast:pose-update", onPose as EventListener);

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const now = performance.now();
      if (now - lastSentRef.current < 33) return; // ~30Hz
      lastSentRef.current = now;
      const pose = latestRef.current;
      if (!pose) return;
      // send best-effort; ignore errors when not on tauri context
      const payload = {
        yaw: pose.yaw ?? 0,
        pitch: pose.pitch ?? 0,
        roll: pose.roll ?? 0,
        blink: pose.blink ?? 0,
        mouth: pose.mouth ?? 0,
      };
      invoke("osc_update", { pose: payload }).catch(() => {});
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener(
        "motioncast:pose-update",
        onPose as EventListener,
      );
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return null;
}

export default OscBridge;
