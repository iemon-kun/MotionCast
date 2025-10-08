import { useCallback, useEffect, useState } from "react";

export function CameraSettingsPanel() {
  const [devices, setDevices] = useState<
    Array<{ deviceId: string; label: string }>
  >([]);
  const [deviceId, setDeviceId] = useState<string>(() => {
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
      const v = Number(localStorage.getItem("camera.fps"));
      return Number.isFinite(v) && v > 0 ? v : 30;
    } catch {
      return 30;
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
  const [running, setRunning] = useState<boolean>(false);

  useEffect(() => {
    const onCamOn: EventListener = () => setRunning(true);
    const onCamOff: EventListener = () => setRunning(false);
    window.addEventListener("motioncast:camera-stream", onCamOn);
    window.addEventListener("motioncast:camera-stopped", onCamOff);
    return () => {
      window.removeEventListener("motioncast:camera-stream", onCamOn);
      window.removeEventListener("motioncast:camera-stopped", onCamOff);
    };
  }, []);

  const dispatchUpdate = useCallback(
    (partial: Partial<{ deviceId: string; resolution: string; fps: number; visible: boolean }>) => {
      try {
        window.dispatchEvent(
          new CustomEvent("motioncast:camera-update-settings", {
            detail: partial,
          }),
        );
      } catch {
        /* noop */
      }
    },
    [],
  );

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === "videoinput");
      const list = cams.map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `カメラ${i + 1}`,
      }));
      setDevices(list);
      if (!deviceId || !list.some((d) => d.deviceId === deviceId)) {
        const first = list[0]?.deviceId || "";
        setDeviceId(first);
        try {
          if (first) localStorage.setItem("camera.deviceId", first);
        } catch {
          /* ignore */
        }
        if (first) dispatchUpdate({ deviceId: first });
      }
    } catch {
      setDevices([]);
    }
  }, [deviceId, dispatchUpdate]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  return (
    <section aria-label="カメラ設定">
      <h3 className="section-title">カメラ設定</h3>
      <div className="ipc-row">
        <label>
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => {
              const v = e.target.checked;
              setVisible(v);
              try {
                localStorage.setItem("camera.visible", String(v));
              } catch {
                /* ignore */
              }
              dispatchUpdate({ visible: v });
            }}
          />
          <span style={{ marginLeft: 6 }}>プレビューを表示</span>
        </label>
      </div>
      {running && (
        <div className="ipc-row small" role="status" aria-live="polite">
          カメラ起動中はデバイス/解像度/FPSの変更は無効です。
        </div>
      )}
      <div className="ipc-row">
        <label>
          <span className="sr-only">カメラデバイス</span>
          <select
            value={deviceId}
            disabled={running}
            onChange={(e) => {
              const id = e.target.value;
              setDeviceId(id);
              try {
                localStorage.setItem("camera.deviceId", id);
              } catch {
                /* ignore */
              }
              dispatchUpdate({ deviceId: id });
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
            disabled={running}
            onChange={(e) => {
              const v = e.target.value;
              setResolution(v);
              try {
                localStorage.setItem("camera.resolution", v);
              } catch {
                /* ignore */
              }
              dispatchUpdate({ resolution: v });
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
            disabled={running}
            onChange={(e) => {
              const nv = Math.max(15, Math.min(60, Number(e.target.value) || 0));
              setFps(nv);
              try {
                localStorage.setItem("camera.fps", String(nv));
              } catch {
                /* ignore */
              }
            }}
            onBlur={() => dispatchUpdate({ fps })}
            className="input-number"
          />
        </label>
        <button className="btn" onClick={() => refreshDevices()} disabled={running}>
          デバイス更新
        </button>
      </div>
    </section>
  );
}

export default CameraSettingsPanel;
