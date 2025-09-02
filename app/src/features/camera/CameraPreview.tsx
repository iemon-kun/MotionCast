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

  const stop = useCallback(() => {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      setStream(null);
    }
    setActive(false);
  }, [stream]);

  const start = useCallback(
    async (opts: StartOptions = { width: 1280, height: 720, fps: 30 }) => {
      try {
        setError(null);
        // 既存ストリームがあれば停止
        if (stream) {
          for (const track of stream.getTracks()) track.stop();
        }
        const videoConstraints: MediaTrackConstraints = {
          width: opts.width,
          height: opts.height,
          frameRate: opts.fps,
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
    [stream, selectedId],
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
        <button className="btn" onClick={() => refreshDevices()}>
          デバイス更新
        </button>
        {active ? (
          <button className="btn" onClick={() => stop()} aria-pressed={active}>
            カメラ停止
          </button>
        ) : (
          <button className="btn primary" onClick={() => start()}>
            カメラ開始（1280x720/30fps）
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
