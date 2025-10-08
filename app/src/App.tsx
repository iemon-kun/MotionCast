import { useEffect, useRef, useState } from "react";
import "./App.css";
import { CameraPreview } from "./features/camera/CameraPreview";
import { CameraSettingsPanel } from "./features/camera/CameraSettingsPanel";
import { VrmPlaceholder } from "./features/vrm/VrmPlaceholder";
import { VrmViewer } from "./features/vrm/VrmViewer";
import { IpcPing } from "./features/ipc/IpcPing";
import { OscTest } from "./features/osc/OscTest";
import { EstimatorTest } from "./features/estimation/EstimatorTest";
import { OscBridge } from "./features/osc/OscBridge";
import { saveLocalStorageToConfig } from "./lib/config";
import { SideRail } from "./features/ui/SideRail";

function App() {
  const [showSidebar, setShowSidebar] = useState(true);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [openMetrics, setOpenMetrics] = useState(true);
  const [cameraActive, setCameraActive] = useState(false);
  const [estFps, setEstFps] = useState<number>(0);
  const [sendHz, setSendHz] = useState<number>(0);
  const [meanLatency, setMeanLatency] = useState<number>(0);
  const [stab, setStab] = useState<{
    hold: number;
    fade: number;
    reacq: number;
  }>({ hold: 0, fade: 0, reacq: 0 });
  const fpsAggRef = useRef<{ last: number; count: number }>({
    last: 0,
    count: 0,
  });
  const [oscInfo, setOscInfo] = useState<{
    sending: boolean;
    addr?: string;
    port?: number;
    rate?: number;
    schema?: string;
  } | null>(null);
  const [camVisible, setCamVisible] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("camera.visible");
      return raw == null ? true : raw !== "false";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const onOsc = (ev: Event) => {
      const ce = ev as CustomEvent<{
        sending: boolean;
        addr?: string;
        port?: number;
        rate?: number;
        schema?: string;
      }>;
      if (!ce.detail) return;
      setOscInfo(ce.detail);
    };
    window.addEventListener("motioncast:osc-state", onOsc as EventListener);
    const onCamOn: EventListener = () => setCameraActive(true);
    const onCamOff: EventListener = () => setCameraActive(false);
    window.addEventListener("motioncast:camera-stream", onCamOn);
    window.addEventListener("motioncast:camera-stopped", onCamOff);
    return () => {
      window.removeEventListener(
        "motioncast:osc-state",
        onOsc as EventListener,
      );
      window.removeEventListener("motioncast:camera-stream", onCamOn);
      window.removeEventListener("motioncast:camera-stopped", onCamOff);
    };
  }, []);

  // Bridge/stabilizer metrics listeners (always installed; cheap handlers)
  useEffect(() => {
    const onBridge = (ev: Event) => {
      const ce = ev as CustomEvent<{ hz?: number; meanLatencyMs?: number }>;
      const hz = Math.round(ce.detail?.hz ?? 0);
      const ms = ce.detail?.meanLatencyMs ?? 0;
      if (Number.isFinite(hz)) setSendHz(hz);
      if (Number.isFinite(ms)) setMeanLatency(ms);
    };
    const onStab = (ev: Event) => {
      const ce = ev as CustomEvent<{
        hold?: number;
        fade?: number;
        reacq?: number;
      }>;
      setStab({
        hold: Math.max(0, Math.floor(ce.detail?.hold ?? 0)),
        fade: Math.max(0, Math.floor(ce.detail?.fade ?? 0)),
        reacq: Math.max(0, Math.floor(ce.detail?.reacq ?? 0)),
      });
    };
    window.addEventListener(
      "motioncast:bridge-metrics",
      onBridge as EventListener,
    );
    window.addEventListener(
      "motioncast:stabilizer-metrics",
      onStab as EventListener,
    );
    return () => {
      window.removeEventListener(
        "motioncast:bridge-metrics",
        onBridge as EventListener,
      );
      window.removeEventListener(
        "motioncast:stabilizer-metrics",
        onStab as EventListener,
      );
    };
  }, []);

  // Estimator FPS counting (only when metrics open)
  useEffect(() => {
    if (!openMetrics) return;
    fpsAggRef.current = { last: performance.now(), count: 0 };
    const onPose = () => {
      const now = performance.now();
      const agg = fpsAggRef.current;
      agg.count += 1;
      if (now - agg.last >= 1000) {
        setEstFps(agg.count);
        agg.count = 0;
        agg.last = now;
      }
    };
    window.addEventListener("motioncast:pose-update", onPose as EventListener);
    return () =>
      window.removeEventListener(
        "motioncast:pose-update",
        onPose as EventListener,
      );
  }, [openMetrics]);

  // Sync metrics-enabled to bridge on mount and when toggled
  useEffect(() => {
    try {
      window.dispatchEvent(
        new CustomEvent("motioncast:metrics-enabled", { detail: openMetrics }),
      );
    } catch {
      /* noop */
    }
  }, [openMetrics]);

  // カメラ表示トグル（サイドバーのCamボタン）を購読
  useEffect(() => {
    const onUpdate = (ev: Event) => {
      const ce = ev as CustomEvent<{ visible?: boolean }>;
      if (typeof ce.detail?.visible === "boolean")
        setCamVisible(ce.detail.visible);
    };
    window.addEventListener(
      "motioncast:camera-update-settings",
      onUpdate as EventListener,
    );
    return () =>
      window.removeEventListener(
        "motioncast:camera-update-settings",
        onUpdate as EventListener,
      );
  }, []);

  // 初期描画後にレイアウト更新を一度発火（起動直後の計測を安定化）
  useEffect(() => {
    const fire = () => {
      try {
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new CustomEvent("motioncast:layout-changed"));
      } catch {
        /* noop */
      }
    };
    const id = requestAnimationFrame(() => requestAnimationFrame(fire));
    return () => cancelAnimationFrame(id);
  }, []);

  // サイドバーの開閉に合わせてレイアウト更新イベントとresizeを発火
  useEffect(() => {
    const fire = () => {
      try {
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new CustomEvent("motioncast:layout-changed"));
      } catch {
        /* noop */
      }
    };
    // 2フレーム後に一度発火（幅トランジションの途中にも対応）
    const id = requestAnimationFrame(() => requestAnimationFrame(fire));
    return () => cancelAnimationFrame(id);
  }, [showSidebar]);

  // サイドバーのwidthトランジション終了時にも確実に発火
  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const fire = () => {
      try {
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new CustomEvent("motioncast:layout-changed"));
      } catch {
        /* noop */
      }
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "width") fire();
    };
    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
  }, []);

  return (
    <main className="app-root">
      <OscBridge />
      <header className="app-header" data-testid="header">
        <button
          className="btn"
          onClick={() => setShowSidebar((v) => !v)}
          aria-label="サイドバー開閉"
        >
          {showSidebar ? "⟨" : "⟩"}
        </button>
        <h1 className="app-title">MotionCast</h1>
        <div className="spacer" />
        <button
          className="btn"
          onClick={async () => {
            await saveLocalStorageToConfig().catch(() => {});
          }}
        >
          保存
        </button>
      </header>

      <div className="app-container">
        <SideRail
          showSidebar={showSidebar}
          onToggleSidebar={() => setShowSidebar((v) => !v)}
        />
        <aside
          className={`sidebar ${showSidebar ? "open" : "closed"}`}
          aria-label="設定サイドバー"
          ref={sidebarRef}
        >
          <div className="sidebar-inner">
            <h2 className="section-title">設定</h2>
            <div className="box" style={{ marginBottom: 8 }}>
              <CameraSettingsPanel />
            </div>
            <div className="box" style={{ marginBottom: 8 }}>
              <h2 className="section-title">推定テスト（スタブ）</h2>
              <EstimatorTest />
            </div>
            <div className="box" style={{ marginBottom: 8 }}>
              <h2 className="section-title">デバッグ: IPC Ping</h2>
              <IpcPing />
            </div>
            <div className="box" style={{ marginBottom: 8 }}>
              <h2 className="section-title">送信テスト（OSC）</h2>
              <OscTest />
            </div>
            <section className="metrics-section">
              <button
                type="button"
                className="metrics-toggle"
                onClick={() => {
                  const next = !openMetrics;
                  setOpenMetrics(next);
                  try {
                    window.dispatchEvent(
                      new CustomEvent("motioncast:metrics-enabled", {
                        detail: next,
                      }),
                    );
                  } catch {
                    /* noop */
                  }
                }}
                aria-expanded={openMetrics}
                aria-controls="metrics"
              >
                メトリクス / ログ
              </button>
              {openMetrics && (
                <div id="metrics" className="metrics-body">
                  <pre className="metrics-pre">
                    {`アプリ起動: OK  カメラ: ${cameraActive ? "稼働中" : "停止中"}  OSC送信: ${
                      oscInfo?.sending
                        ? `送信中 → udp://${oscInfo.addr ?? "?"}:${oscInfo.port ?? "?"} @ ${oscInfo.rate ?? "?"}fps [${oscInfo.schema ?? "?"}]`
                        : "停止中"
                    }`}
                  </pre>
                  <pre className="metrics-pre">
                    {`推定FPS: ${estFps} / 送信: ${sendHz}Hz / 平均遅延: ${meanLatency.toFixed(1)}ms | 安定化: hold ${
                      stab.hold
                    } / fade ${stab.fade} / reacq ${stab.reacq}`}
                  </pre>
                </div>
              )}
            </section>
          </div>
        </aside>

        <section className="content">
          <div className="content-grid">
            <div
              className="box"
              style={{ display: camVisible ? "block" : "none" }}
            >
              <h2 className="section-title">カメラプレビュー</h2>
              <CameraPreview inlineControls="minimal" />
            </div>
            <div className="box">
              <h2 className="section-title">VRMビューア</h2>
              <VrmPlaceholder />
              <VrmViewer />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
