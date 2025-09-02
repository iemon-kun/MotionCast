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
          // Head pose matrix
          // (APIによって 'facialTransformationMatrices' と表記される場合がある)
          outputFacialTransformationMatrices: true as unknown as boolean,
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
        const res = lm.detectForVideo(video, ts) as unknown as {
          faceBlendshapes?: {
            categories: { categoryName: string; score: number }[];
          }[];
          facialTransformationMatrixes?: Array<
            Float32Array | number[] | { data: number[] }
          >;
          facialTransformationMatrices?: Array<
            Float32Array | number[] | { data: number[] }
          >;
        };
        const bs = res?.faceBlendshapes?.[0]?.categories ?? [];
        const cat = (name: string) =>
          bs.find((c) => c.categoryName === name)?.score ?? 0;
        const blink = (cat("eyeBlinkLeft") + cat("eyeBlinkRight")) / 2;
        const mouth = cat("jawOpen");
        // Try to extract head pose from facial transformation matrix
        let yaw = 0,
          pitch = 0,
          roll = 0;
        try {
          const mats = (res.facialTransformationMatrixes ??
            res.facialTransformationMatrices) as
            | Array<Float32Array | number[] | { data: number[] }>
            | undefined;
          const raw = mats && mats[0];
          const arr = raw
            ? Array.isArray(raw)
              ? (raw as number[])
              : typeof (raw as { data?: unknown }).data !== "undefined"
                ? ((raw as { data: unknown }).data as number[])
                : Array.from(raw as Float32Array)
            : undefined;
          if (arr && arr.length >= 16) {
            // Assume column-major 4x4
            const r00 = arr[0];
            // const r01 = arr[4];
            // const r02 = arr[8];
            const r10 = arr[1];
            // const r11 = arr[5];
            // const r12 = arr[9];
            const r20 = arr[2];
            const r21 = arr[6];
            const r22 = arr[10];
            // XYZ (pitch-x, yaw-y, roll-z) approximation
            pitch = Math.asin(-Math.max(-1, Math.min(1, r20)));
            roll = Math.atan2(r21, r22);
            yaw = Math.atan2(r10, r00);
            const clamp = (x: number, a: number) =>
              Math.max(-a, Math.min(a, x));
            yaw = clamp(yaw, Math.PI / 2);
            pitch = clamp(pitch, Math.PI / 2);
            roll = clamp(roll, Math.PI / 2);
          }
        } catch {
          // ignore matrix failures
        }
        const detail = {
          yaw,
          pitch,
          roll,
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
