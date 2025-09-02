import { useEffect, useRef, useState } from "react";

type MPModuleLite = {
  FilesetResolver: { forVisionTasks: (base: string) => Promise<unknown> };
  FaceLandmarker: {
    createFromOptions: (vision: unknown, opts: unknown) => Promise<unknown>;
  };
};

export function useFaceLandmarker(enabled: boolean) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<unknown>(null);
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    let canceled = false;
    (async () => {
      try {
        setError(null);
        // Dynamic import from CDN
        const url =
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
        // @vite-ignore to allow remote ESM import at runtime
        const modUnknown = await import(/* @vite-ignore */ url as string);
        const mod = modUnknown as unknown as MPModuleLite;
        const vision = (await mod.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
        )) as unknown;
        if (canceled) return;
        const face = (await mod.FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          },
          runningMode: "VIDEO",
          outputFaceBlendshapes: true,
          numFaces: 1,
        })) as unknown;
        if (canceled) return;
        landmarkerRef.current = face;
        setLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました");
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
      const lk = landmarkerRef.current;
      if (!video || !lk) return;
      const ts = performance.now();
      // Throttle to ~30fps for detection
      if (ts - lastTsRef.current < 33) return;
      lastTsRef.current = ts;
      try {
        const lm = landmarkerRef.current as {
          detectForVideo: (
            v: HTMLVideoElement,
            ts: number,
          ) => {
            faceBlendshapes?: {
              categories: { categoryName: string; score: number }[];
            }[];
          };
        };
        const res = lm.detectForVideo(video, ts);
        const bs = res?.faceBlendshapes?.[0]?.categories ?? [];
        const cat = (name: string) =>
          bs.find((c) => c.categoryName === name)?.score ?? 0;
        const blink = (cat("eyeBlinkLeft") + cat("eyeBlinkRight")) / 2;
        const mouth = cat("jawOpen");
        const detail = {
          yaw: 0,
          pitch: 0,
          roll: 0,
          blink,
          mouth,
          ts,
        };
        window.dispatchEvent(
          new CustomEvent("motioncast:pose-update", { detail }),
        );
      } catch {
        // swallow per-frame errors to keep loop running
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, loaded]);

  return { loaded, error } as const;
}
