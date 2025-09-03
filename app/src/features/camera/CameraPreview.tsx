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
  // Avoid concurrent start() calls and race conditions
  const startLockRef = useRef(false);
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
  const [visible, setVisible] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("camera.visible");
      return raw == null ? true : raw !== "false";
    } catch {
      return true;
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
  const [measW, setMeasW] = useState<number | null>(null);
  const [measH, setMeasH] = useState<number | null>(null);
  const [measFps, setMeasFps] = useState<number | null>(null);

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
    // Detach from <video> to fully release sinks
    try {
      const el = videoRef.current;
      if (el) el.srcObject = null;
    } catch {
      /* ignore */
    }
    setActive(false);
    try {
      window.dispatchEvent(new CustomEvent("motioncast:camera-stopped"));
    } catch {
      void 0;
    }
  }, [stream]);

  const start = useCallback(
    async (opts?: StartOptions) => {
      if (startLockRef.current) return; // prevent re-entrancy
      startLockRef.current = true;
      try {
        setError(null);
        // 既存ストリームがあれば停止
        if (stream) {
          try {
            for (const track of stream.getTracks()) track.stop();
          } catch {
            /* ignore */
          }
          setStream(null);
          const el0 = videoRef.current;
          if (el0) el0.srcObject = null;
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
        // Try with selected device first; on NotFound/Overconstrained, fallback without deviceId
        let s: MediaStream | null = null;
        try {
          s = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
          const name = (err as { name?: string } | undefined)?.name || "";
          const over = name === "OverconstrainedError" || name === "NotFoundError";
          if (over && selectedId) {
            try {
              const vc2: MediaTrackConstraints = { ...videoConstraints };
              delete (vc2 as any).deviceId;
              s = await navigator.mediaDevices.getUserMedia({ video: vc2, audio: false });
              // Reset invalid persisted deviceId
              setSelectedId("");
              try { localStorage.setItem("camera.deviceId", ""); } catch { /* ignore */ }
            } catch (e2) {
              throw err; // keep original error message
            }
          } else {
            throw err;
          }
        }
        const sNonNull = s as MediaStream;
        setStream(sNonNull);
        setActive(true);
        // 実測値の更新
        const t = sNonNull.getVideoTracks()[0];
        if (t) {
          const st = t.getSettings();
          setMeasW(typeof st.width === "number" ? st.width : null);
          setMeasH(typeof st.height === "number" ? st.height : null);
          setMeasFps(typeof st.frameRate === "number" ? st.frameRate : null);
        } else {
          setMeasW(null);
          setMeasH(null);
          setMeasFps(null);
        }
        const el = videoRef.current;
        if (el) {
          el.srcObject = sNonNull;
          try {
            await el.play();
          } catch {
            void 0;
          }
          try {
            const container = el.parentElement as HTMLElement | null;
            if (container) {
              const rect = container.getBoundingClientRect();
              const w = Math.max(1, Math.floor(rect.width));
              const h = Math.max(1, Math.floor(rect.height));
              el.width = w;
              el.height = h;
            }
          } catch {
            void 0;
          }
          try {
            window.dispatchEvent(
              new CustomEvent("motioncast:camera-stream", {
                detail: { video: el },
              }),
            );
          } catch {
            void 0;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "不明なエラー";
        setError(`カメラにアクセスできません: ${msg}`);
        setActive(false);
      } finally {
        startLockRef.current = false;
      }
    },
    [stream, selectedId, resolution, fps, parseResolution],
  );

  // Unmount cleanup: stop any tracks without toggling UI state/events
  useEffect(() => {
    return () => {
      try {
        const s = (videoRef.current?.srcObject as MediaStream | null) ?? stream;
        if (s) {
          for (const track of s.getTracks()) track.stop();
        }
      } catch {
        /* ignore */
      }
    };
  }, []);

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

  // Keep <video> intrinsic size in sync with container size
  useEffect(() => {
    const el = videoRef.current;
    const container = el?.parentElement as HTMLElement | null;
    if (!el || !container) return;
    const ro = new ResizeObserver(() => {
      try {
        const rect = container.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        el.width = w;
        el.height = h;
      } catch {
        /* ignore */
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [visible]);

  // エラーに応じた対処ガイド
  const buildErrorHelp = useCallback((err: unknown): string[] => {
    const tips: string[] = [];
    let name = "";
    if (err instanceof DOMException) {
      name = err.name;
    } else if (typeof err === "object" && err !== null && "name" in err) {
      const n = (err as { name?: unknown }).name;
      name = typeof n === "string" ? n : "";
    }
    switch (name) {
      case "NotAllowedError":
      case "SecurityError":
        tips.push(
          "カメラの使用を許可してください（初回ダイアログ／OSのプライバシー設定）",
          "macOS: システム設定 → プライバシーとセキュリティ → カメラ → MotionCast を許可",
        );
        break;
      case "NotFoundError":
        tips.push(
          "カメラが見つかりません。接続状態を確認し、デバイス更新を押してください",
          "仮想カメラや外付けカメラの場合はドライバ/アプリの起動を確認",
        );
        break;
      case "NotReadableError":
      case "AbortError":
        tips.push(
          "別アプリがカメラを使用中の可能性があります。使用中アプリを閉じて再試行",
          "USB の抜き挿し／PC再起動で改善する場合があります",
        );
        break;
      case "OverconstrainedError":
        tips.push(
          "選択中の解像度/FPSをサポートしていない可能性があります。値を下げて再試行",
          "推奨: 1280x720 / 30fps",
        );
        break;
      case "TypeError":
        tips.push(
          "制約が不正です。既定値に戻して再試行してください（1280x720/30fps）",
        );
        break;
      default:
        tips.push("一時的なエラーの可能性があります。再試行してください");
    }
    tips.push(
      "問題が続く場合は、デバイス更新またはアプリの再起動をお試しください",
    );
    return tips;
  }, []);

  const resetToDefaults = useCallback(async () => {
    setResolution("1280x720");
    setFps(30);
    try {
      localStorage.setItem("camera.resolution", "1280x720");
      localStorage.setItem("camera.fps", "30");
    } catch {
      void 0;
    }
    if (visible) await start({ width: 1280, height: 720, fps: 30 });
  }, [start, visible]);

  return (
    <section aria-label="カメラプレビュー" className="camera-section">
      <div className="camera-toolbar">
        <button
          className="btn"
          aria-pressed={visible}
          onClick={() => {
            const next = !visible;
            setVisible(next);
            try {
              localStorage.setItem("camera.visible", String(next));
            } catch {
              void 0;
            }
            // プレビューの表示/非表示はストリーム制御と切り離す。
            // 継続して推定/送信が動くよう、ここでは停止しない。
          }}
        >
          {visible ? "カメラ非表示" : "カメラ表示"}
        </button>
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
      <div className="camera-measured" aria-live="polite">
        実測: {measW && measH ? `${measW}x${measH}` : "-"} /
        {measFps != null ? ` ${Math.round(measFps * 100) / 100}fps` : " -fps"}
        {' '}| 状態: {active ? '稼働中' : '停止中'}
      </div>
      {visible && error && (
        <div className="camera-error" role="alert">
          <div>{error}</div>
          <ul className="camera-help">
            {buildErrorHelp(error).map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
          <div className="camera-actions">
            <button className="btn" onClick={() => start()}>
              再試行
            </button>
            <button className="btn" onClick={() => resetToDefaults()}>
              推奨設定に戻す
            </button>
          </div>
        </div>
      )}
      <div
        className="camera-preview"
        style={{ display: visible ? "block" : "none" }}
        aria-hidden={!visible}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="camera-video"
        />
      </div>
    </section>
  );
}

export default CameraPreview;
