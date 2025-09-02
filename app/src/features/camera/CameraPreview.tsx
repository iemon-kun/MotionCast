import { useCallback, useEffect, useRef, useState } from "react";

type StartOptions = {
  width?: number;
  height?: number;
  fps?: number;
};

export function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [devices, setDevices] = useState<
    Array<{ deviceId: string; label: string }>
  >([]);
  const [selectedId, setSelectedId] = useState<string>(() => {
    try {
      return localStorage.getItem("camera.deviceId") || "";
    } catch {
      return "";
    }
  });
  const [resolution, setResolution] = useState<string>(() => {
    try {
      return localStorage.getItem("camera.resolution") || "1280x720";
    } catch {
      return "1280x720";
    }
  });
  const [fps, setFps] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("camera.fps"));
      return Number.isFinite(saved) && saved > 0 ? saved : 30;
    } catch {
      return 30;
    }
  });

  const parseResolution = useCallback(
    (res: string): { width: number; height: number } => {
      const m = res.match(/^(\d+)x(\d+)$/);
      if (!m) return { width: 1280, height: 720 };
      return { width: Number(m[1]), height: Number(m[2]) };
    },
    [],
  );

  const stop = useCallback(() => {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      setStream(null);
    }
    setActive(false);
  }, [stream]);

  const start = useCallback(
    async (opts?: StartOptions) => {
      try {
        setError(null);
        // 既存ストリームがあれば停止
        if (stream) {
          for (const track of stream.getTracks()) track.stop();
        }
        const { width, height } = parseResolution(
          opts?.width && opts?.height
            ? `${opts.width}x${opts.height}`
            : resolution,
        );
        const reqFps = opts?.fps ?? fps;
        const videoConstraints: MediaTrackConstraints = {
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: reqFps },
        };
        if (selectedId) {
          // exact指定で選択デバイスを優先
          (videoConstraints as MediaTrackConstraints).deviceId = {
            exact: selectedId,
          } as ConstrainDOMString;
        }
        const constraints: MediaStreamConstraints = {
          video: videoConstraints,
          audio: false,
        };
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        setStream(s);
        setActive(true);
        const el = videoRef.current;
        if (el) {
          el.srcObject = s;
          try {
            await el.play();
          } catch {
            void 0;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "不明なエラー";
        setError(`カメラにアクセスできません: ${msg}`);
        setActive(false);
      }
    },
    [stream, selectedId, resolution, fps, parseResolution],
  );

  useEffect(() => {
    return () => stop();
  }, [stop]);

  // デバイス一覧を取得
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === "videoinput");
      const list = cams.map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `カメラ${i + 1}`,
      }));
      setDevices(list);
      // 選択の正規化
      if (!selectedId || !list.some((d) => d.deviceId === selectedId)) {
        const first = list[0]?.deviceId || "";
        setSelectedId(first);
        try {
          if (first) localStorage.setItem("camera.deviceId", first);
        } catch {
          void 0;
        }
      }
    } catch {
      // 権限未許可でも deviceId は取得可能だが label は空のことがある
      setDevices([]);
    }
  }, [selectedId]);

  useEffect(() => {
    refreshDevices();
    const handler: EventListener = () => {
      void refreshDevices();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    };
  }, [refreshDevices]);

  return (
    <section aria-label="カメラプレビュー" className="camera-section">
      <div className="camera-toolbar">
        <label>
          <span className="sr-only">カメラデバイス</span>
          <select
            value={selectedId}
            onChange={async (e) => {
              const id = e.target.value;
              setSelectedId(id);
              try {
                localStorage.setItem("camera.deviceId", id);
              } catch {
                void 0;
              }
              if (active) await start();
            }}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">解像度</span>
          <select
            value={resolution}
            onChange={async (e) => {
              const v = e.target.value;
              setResolution(v);
              try {
                localStorage.setItem("camera.resolution", v);
              } catch {
                void 0;
              }
              if (active) await start();
            }}
          >
            <option value="1920x1080">1920x1080</option>
            <option value="1280x720">1280x720</option>
            <option value="960x540">960x540</option>
          </select>
        </label>
        <label>
          <span className="sr-only">FPS</span>
          <input
            type="number"
            min={15}
            max={60}
            step={1}
            value={fps}
            onChange={(e) => {
              const v = Math.max(15, Math.min(60, Number(e.target.value) || 0));
              setFps(v);
              try {
                localStorage.setItem("camera.fps", String(v));
              } catch {
                void 0;
              }
            }}
            onBlur={async () => {
              if (active) await start();
            }}
            className="input-number"
          />
        </label>
        <button className="btn" onClick={() => refreshDevices()}>
          デバイス更新
        </button>
        {active ? (
          <button className="btn" onClick={() => stop()} aria-pressed={active}>
            カメラ停止
          </button>
        ) : (
          <button className="btn primary" onClick={() => start()}>
            カメラ開始（{resolution}/{fps}fps）
          </button>
        )}
      </div>
      {error && (
        <p className="camera-error" role="alert">
          {error}
        </p>
      )}
      <div className="camera-preview">
        <video ref={videoRef} muted playsInline className="camera-video" />
      </div>
    </section>
  );
}

export default CameraPreview;
