import { useEffect, useRef, useState } from "react";

export type PoseFrame = {
  yaw: number; // rad
  pitch: number; // rad
  roll: number; // rad
  blink: number; // 0..1
  mouth: number; // 0..1
  ts: number; // ms
};

/**
 * Stub estimator that emits smooth values for development.
 * Later replace the internals with MediaPipe Face Landmarker.
 */
export function useEstimator(enabled = true, fps = 30) {
  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const enabledRef = useRef(enabled);
  const fpsRef = useRef(fps);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);

  useEffect(() => {
    let raf = 0;
    let acc = 0;
    let t = 0;
    const start = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - (start + t)) / 1000;
      t = now - start;
      const interval = 1 / Math.max(1, fpsRef.current);
      acc += Math.max(0, dt);
      if (!enabledRef.current || acc < interval) return;
      acc = 0;
      const s = t / 1000; // seconds
      // Smooth periodic motion
      const yaw = Math.sin(s * 0.7) * 0.3; // ±0.3rad
      const pitch = Math.sin(s * 0.9 + 1.2) * 0.2;
      const roll = Math.sin(s * 1.3 + 2.1) * 0.15;
      const blink = Math.abs(Math.sin(s * 2.0));
      const mouth = Math.abs(Math.sin(s * 1.5 + 0.7)) * 0.7;
      const f: PoseFrame = { yaw, pitch, roll, blink, mouth, ts: now };
      setFrame(f);
      try {
        window.dispatchEvent(
          new CustomEvent<PoseFrame>("motioncast:pose-update", { detail: f }),
        );
      } catch {
        // ignore
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return { frame } as const;
}
