import { useEffect, useRef, useState } from "react";

type MPModuleLite = {
  FilesetResolver: { forVisionTasks: (base: string) => Promise<unknown> };
  PoseLandmarker: {
    createFromOptions: (vision: unknown, opts: unknown) => Promise<unknown>;
  };
};

export type PosePoint = { x: number; y: number; z?: number; v?: number };
export type UpperBodyDetail = {
  lShoulder?: PosePoint;
  lElbow?: PosePoint;
  lWrist?: PosePoint;
  rShoulder?: PosePoint;
  rElbow?: PosePoint;
  rWrist?: PosePoint;
  ts: number;
};

/**
 * MediaPipe Pose Landmarker (upper-body focus).
 * Emits `motioncast:upper-body-update` with selected joints at ~fps.
 */
export function usePoseLandmarker(enabled: boolean, fps = 15) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const landmarkerRef = useRef<unknown>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    let canceled = false;
    (async () => {
      try {
        setError(null);
        const url =
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
        // @vite-ignore to allow remote ESM import at runtime
        const modUnknown = await import(/* @vite-ignore */ url as string);
        const mod = modUnknown as unknown as MPModuleLite;
        const vision = (await mod.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
        )) as unknown;
        if (canceled) return;
        const pose = (await mod.PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            // Mediapipe公開の一般Poseモデル。上半身のみ使用。
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })) as unknown;
        if (canceled) return;
        landmarkerRef.current = pose;
        setLoaded(true);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Poseの読み込みに失敗しました",
        );
      }
    })();
    return () => {
      canceled = true;
      // TODO: 将来 close() サポートを確認の上、呼び出しを追加
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onCam = (ev: Event) => {
      const ce = ev as CustomEvent<{ video: HTMLVideoElement }>;
      if (!ce.detail?.video) return;
      videoRef.current = ce.detail.video;
    };
    const onStop = () => {
      videoRef.current = null;
    };
    window.addEventListener("motioncast:camera-stream", onCam as EventListener);
    window.addEventListener("motioncast:camera-stopped", onStop);
    return () => {
      window.removeEventListener(
        "motioncast:camera-stream",
        onCam as EventListener,
      );
      window.removeEventListener("motioncast:camera-stopped", onStop);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    // EMA smoothing state for points we care about
    const smooth: Record<string, PosePoint> = {};
    const alpha = 0.2;

    const idx = {
      // MediaPipe Pose Landmarks indices
      lShoulder: 11,
      rShoulder: 12,
      lElbow: 13,
      rElbow: 14,
      lWrist: 15,
      rWrist: 16,
    } as const;

    const ema = (key: string, p: PosePoint) => {
      const s = smooth[key];
      if (!s) {
        smooth[key] = { ...p };
        return smooth[key];
      }
      s.x += alpha * (p.x - s.x);
      s.y += alpha * (p.y - s.y);
      if (typeof p.z === "number")
        s.z = (s.z ?? 0) + alpha * (p.z - (s.z ?? 0));
      if (typeof p.v === "number")
        s.v = (s.v ?? 0) + alpha * (p.v - (s.v ?? 0));
      return s;
    };

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const video = videoRef.current;
      const lk = landmarkerRef.current as unknown as {
        detectForVideo: (
          v: HTMLVideoElement,
          ts: number,
        ) => {
          landmarks?: { x: number; y: number; z?: number }[][];
          worldLandmarks?: unknown;
        };
      };
      if (!video || !lk) return;
      const now = performance.now();
      const interval = 1000 / Math.max(1, fps);
      if (now - lastTsRef.current < interval) return;
      lastTsRef.current = now;
      try {
        const res = lk.detectForVideo(video, now) as unknown as {
          landmarks?: Array<
            Array<{ x: number; y: number; z?: number; visibility?: number }>
          >;
        };
        const first = res?.landmarks?.[0];
        if (!first) return;
        const pick = (i: number): PosePoint | undefined => {
          const p = first[i];
          if (!p) return undefined;
          return { x: p.x, y: p.y, z: p.z, v: p.visibility };
        };
        const detailRaw: UpperBodyDetail = {
          lShoulder: pick(idx.lShoulder),
          lElbow: pick(idx.lElbow),
          lWrist: pick(idx.lWrist),
          rShoulder: pick(idx.rShoulder),
          rElbow: pick(idx.rElbow),
          rWrist: pick(idx.rWrist),
          ts: now,
        };
        const detail: UpperBodyDetail = {
          lShoulder:
            detailRaw.lShoulder && ema("lShoulder", detailRaw.lShoulder),
          lElbow: detailRaw.lElbow && ema("lElbow", detailRaw.lElbow),
          lWrist: detailRaw.lWrist && ema("lWrist", detailRaw.lWrist),
          rShoulder:
            detailRaw.rShoulder && ema("rShoulder", detailRaw.rShoulder),
          rElbow: detailRaw.rElbow && ema("rElbow", detailRaw.rElbow),
          rWrist: detailRaw.rWrist && ema("rWrist", detailRaw.rWrist),
          ts: now,
        } as UpperBodyDetail;
        window.dispatchEvent(
          new CustomEvent<UpperBodyDetail>("motioncast:upper-body-update", {
            detail,
          }),
        );
      } catch {
        // swallow per-frame errors
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, fps]);

  return { loaded, error } as const;
}
