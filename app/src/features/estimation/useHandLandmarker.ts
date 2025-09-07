import { useEffect, useRef, useState } from "react";

type MPModuleLite = {
  FilesetResolver: { forVisionTasks: (base: string) => Promise<unknown> };
  HandLandmarker: {
    createFromOptions: (vision: unknown, opts: unknown) => Promise<unknown>;
  };
};

export type HandWorld = {
  handed: "Left" | "Right";
  world: Array<{ x: number; y: number; z: number }>;
  curls: {
    thumb: number;
    index: number;
    middle: number;
    ring: number;
    pinky: number;
  };
  wrist?: { x: number; y: number; z: number };
  ts: number;
};

function norm(v: { x: number; y: number; z: number }) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function sub(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export function useHandLandmarker(enabled: boolean, fps = 30) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handRef = useRef<unknown>(null);
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
        // @vite-ignore
        const modUnknown = await import(/* @vite-ignore */ url as string);
        const mod = modUnknown as unknown as MPModuleLite;
        const vision = (await mod.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
        )) as unknown;
        if (canceled) return;
        // Try known model asset paths (standard first, then lite as fallback)
        const candidates = [
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker_lite/float16/1/hand_landmarker_lite.task",
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float32/1/hand_landmarker.task",
        ];
        let hand: unknown | null = null;
        let lastErr: unknown = null;
        for (const url of candidates) {
          try {
            hand = (await mod.HandLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: url },
              runningMode: "VIDEO",
              numHands: 2,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
              outputHandedness: true,
            })) as unknown;
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (!hand) throw lastErr ?? new Error("HandLandmarker init failed");
        if (canceled) return;
        handRef.current = hand;
        setLoaded(true);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Handsの読み込みに失敗しました",
        );
      }
    })();
    return () => {
      canceled = true;
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
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const video = videoRef.current;
      const lk = handRef.current as unknown as {
        detectForVideo: (
          v: HTMLVideoElement,
          ts: number,
        ) => {
          worldLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
          landmarks?: Array<Array<{ x: number; y: number; z: number }>>;
          handednesses?: Array<{
            categories: { categoryName: string; score: number }[];
          }>;
        };
      };
      if (!video || !lk) return;
      const ts = performance.now();
      const interval = 1000 / Math.max(1, fps);
      if (ts - lastTsRef.current < interval) return;
      lastTsRef.current = ts;
      try {
        const res = lk.detectForVideo(video, ts) as unknown as {
          worldLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
          handednesses?: Array<{
            categories: { categoryName: string; score: number }[];
          }>;
        };
        const wls = res?.worldLandmarks ?? [];
        const handeds = res?.handednesses ?? [];
        const hands: HandWorld[] = [];
        const curlOf = (
          pts: Array<{ x: number; y: number; z: number }>,
          a: number,
          b: number,
          c: number,
        ) => {
          // angle between (b-a) and (c-b)
          const v1 = norm(sub(pts[b], pts[a]));
          const v2 = norm(sub(pts[c], pts[b]));
          const dot = Math.max(
            -1,
            Math.min(1, v1.x * v2.x + v1.y * v2.y + v1.z * v2.z),
          );
          const ang = Math.acos(dot);
          // normalize ~ [0..1] where 0=open,1=fully curled (~120deg)
          return clamp01(ang / ((Math.PI * 2) / 3));
        };
        for (let i = 0; i < wls.length; i++) {
          const pts = wls[i] || [];
          if (pts.length < 21) continue;
          const handed =
            handeds[i]?.categories?.[0]?.categoryName === "Left"
              ? "Left"
              : "Right";
          const curls = {
            thumb: curlOf(pts, 2, 3, 4),
            index: curlOf(pts, 5, 6, 8),
            middle: curlOf(pts, 9, 10, 12),
            ring: curlOf(pts, 13, 14, 16),
            pinky: curlOf(pts, 17, 18, 20),
          };
          hands.push({
            handed,
            world: pts.slice(0, 21),
            curls,
            wrist: pts[0],
            ts,
          });
        }
        if (hands.length) {
          try {
            window.dispatchEvent(
              new CustomEvent("motioncast:hands-3d", {
                detail: hands,
              }),
            );
          } catch {
            /* noop */
          }
        }
      } catch {
        // ignore
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, fps]);

  return { loaded, error } as const;
}
